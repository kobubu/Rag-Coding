import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { CMError, inside, utf8 } from "../code-memory/source.js";

export async function text(path: string): Promise<string | undefined> {
  try { return utf8(await readFile(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
export async function safeTarget(root: string, path: string): Promise<void> {
  root = resolve(root); path = resolve(path);
  if (!inside(root, path) || root === path) throw new CMError("invalid_argument", "Setup target must stay inside its selected directory");
  const suffix = relative(root, path);
  root = await realpath(root);
  let current = root;
  for (const piece of suffix.split(sep)) {
    current = join(current, piece);
    try { if ((await lstat(current)).isSymbolicLink()) throw new CMError("invalid_argument", "Setup does not overwrite symlink/junction targets"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
export type Edit = { root: string; path: string; before: string | undefined; after: string | undefined };
export async function change(edit: Edit) {
  await safeTarget(edit.root, edit.path);
  if (await text(edit.path) !== edit.before) throw new CMError("config_changed", "Configuration changed during setup; retry without discarding other edits");
  if (edit.after === edit.before) return;
  if (edit.after === undefined) { await unlink(edit.path); return; }
  await mkdir(dirname(edit.path), { recursive: true });
  await safeTarget(edit.root, edit.path);
  const temporary = edit.path + "." + randomUUID() + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(edit.after); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, edit.path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
export async function transaction(edits: Edit[]) {
  const applied: Edit[] = [];
  try { for (const edit of edits) { await change(edit); applied.push(edit); } }
  catch (error) {
    const failures: unknown[] = [];
    for (const edit of applied.reverse()) {
      try { await change({ ...edit, before: edit.after, after: edit.before }); } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Setup failed; concurrently changed files were preserved during rollback");
    throw error;
  }
}
