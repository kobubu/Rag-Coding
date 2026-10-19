import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EMBEDDING } from "./vector.js";
import { CMError, hash } from "./source.js";
const ARTIFACTS = {
    "tokenizer.json": "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    "onnx/model_quantized.onnx": "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
};
const models = new Map();
export function poolNormalized(hidden, mask, batch, width, dimensions) {
    if (hidden.length !== batch * width * dimensions || mask.length !== batch * width || !batch || !width || !dimensions)
        throw new CMError("invalid_vectors", "Unexpected MiniLM output shape");
    const vectors = [];
    for (let row = 0; row < batch; row++) {
        const mean = new Float32Array(dimensions);
        let count = 0;
        for (let column = 0; column < width; column++) {
            const weight = mask[row * width + column];
            if (weight !== 0n && weight !== 1n)
                throw new CMError("invalid_vectors", "Invalid attention mask");
            count += Number(weight);
        }
        if (!count)
            throw new CMError("invalid_vectors", "Empty attention mask");
        for (let dimension = 0; dimension < dimensions; dimension++) {
            let sum = 0;
            for (let column = 0; column < width; column++)
                sum += hidden[(row * width + column) * dimensions + dimension] * Number(mask[row * width + column]);
            mean[dimension] = sum / count;
        }
        const norm = Math.fround(Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0)));
        if (!Number.isFinite(norm) || norm === 0)
            throw new CMError("invalid_vectors", "Invalid MiniLM norm");
        for (let dimension = 0; dimension < dimensions; dimension++)
            mean[dimension] = mean[dimension] / norm;
        vectors.push(Array.from(mean));
    }
    return vectors;
}
async function load(cache) {
    const directory = join(cache, EMBEDDING.model, EMBEDDING.revision);
    const artifacts = await Promise.all(Object.entries(ARTIFACTS).map(async ([name, digest]) => {
        const raw = await readFile(join(directory, name));
        if (hash(raw) !== digest)
            throw new CMError("invalid_vectors", "Pinned MiniLM artifact differs: " + name);
        return raw;
    }));
    const [{ Tokenizer }, { InferenceSession, Tensor }] = await Promise.all([import("@huggingface/tokenizers"), import("onnxruntime-node")]);
    const tokenizer = new Tokenizer(JSON.parse(artifacts[0].toString("utf8")), JSON.parse(artifacts[1].toString("utf8")));
    const session = await InferenceSession.create(artifacts[2], { executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1 });
    if (session.inputNames.join(",") !== "input_ids,attention_mask,token_type_ids" || !session.outputNames.includes("last_hidden_state")) {
        await session.release();
        throw new CMError("invalid_vectors", "Unsupported pinned MiniLM interface");
    }
    return { tokenizer, session, tensor: Tensor };
}
export function miniLMEmbedder(cache) {
    const key = resolve(cache);
    return async (texts, signal) => {
        signal?.throwIfAborted();
        if (!texts.length)
            return [];
        let pending = models.get(key);
        if (!pending) {
            pending = load(key);
            models.set(key, pending);
            pending.catch(() => { if (models.get(key) === pending)
                models.delete(key); });
        }
        const model = await pending;
        signal?.throwIfAborted();
        const encoded = texts.map(text => model.tokenizer.encode(text, { return_token_type_ids: true }));
        const width = Math.min(512, Math.max(...encoded.map(item => item.ids.length)));
        const ids = new BigInt64Array(texts.length * width), mask = new BigInt64Array(ids.length), types = new BigInt64Array(ids.length);
        for (const [row, item] of encoded.entries())
            for (let column = 0; column < Math.min(width, item.ids.length); column++) {
                const offset = row * width + column;
                ids[offset] = BigInt(item.ids[column]);
                mask[offset] = 1n;
                types[offset] = BigInt(item.token_type_ids[column]);
            }
        const shape = [texts.length, width], outputs = await model.session.run({ input_ids: new model.tensor("int64", ids, shape), attention_mask: new model.tensor("int64", mask, shape), token_type_ids: new model.tensor("int64", types, shape) });
        signal?.throwIfAborted();
        const hidden = outputs.last_hidden_state;
        if (!(hidden.data instanceof Float32Array) || hidden.dims.join(",") !== [texts.length, width, EMBEDDING.dimensions].join(","))
            throw new CMError("invalid_vectors", "Unexpected MiniLM hidden state");
        return poolNormalized(hidden.data, mask, texts.length, width, EMBEDDING.dimensions);
    };
}
