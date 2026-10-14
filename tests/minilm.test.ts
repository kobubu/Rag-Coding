import assert from "node:assert/strict";
import test from "node:test";
import { poolNormalized, miniLMEmbedder } from "../src/code-memory/minilm.js";
test("MiniLM mean pooling excludes padding, keeps batch boundaries and produces unit vectors", () => {
  const hidden=new Float32Array([3,0,0,4,999,999,0,5,777,777,777,777]);
  const [first,second]=poolNormalized(hidden,new BigInt64Array([1n,1n,0n,1n,0n,0n]),2,3,2);
  assert(Math.abs(first![0]!-.6)<1e-7);assert(Math.abs(first![1]!-.8)<1e-7);assert.deepEqual(second,[0,1]);
  assert.throws(()=>poolNormalized(hidden,new BigInt64Array(6),2,3,2),/Empty attention/);
  assert.throws(()=>poolNormalized(hidden,new BigInt64Array([1n,2n,0n,1n,0n,0n]),2,3,2),/Invalid attention/);
  assert.throws(()=>poolNormalized(hidden,new BigInt64Array(4),2,3,2),/shape/);
});
test("cached MiniLM refuses cancellation before loading any files and supports an empty batch", async () => {
  const embed=miniLMEmbedder("no-model-files"),cancel=new AbortController();cancel.abort();
  await assert.rejects(embed(["hello"],cancel.signal));assert.deepEqual(await embed([]),[]);
});
