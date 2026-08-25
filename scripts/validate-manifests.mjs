import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const libraryPath = path.join(root, "library-manifest.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function validateTimings(reciterId, chapter) {
  assert(Number.isInteger(chapter.chapter) && chapter.chapter >= 1 && chapter.chapter <= 114, `${reciterId}: invalid chapter number`);
  assert(typeof chapter.downloadUrl === "string" && /^https:\/\//.test(chapter.downloadUrl), `${reciterId}:${chapter.chapter}: invalid download URL`);
  assert(/^[a-f0-9]{64}$/i.test(chapter.sha256), `${reciterId}:${chapter.chapter}: invalid SHA-256`);
  assert(Number.isInteger(chapter.durationMs) && chapter.durationMs > 0, `${reciterId}:${chapter.chapter}: invalid duration`);
  assert(Array.isArray(chapter.ayahs) && chapter.ayahs.length > 0, `${reciterId}:${chapter.chapter}: missing ayah timings`);

  let previousEnd = 0;
  chapter.ayahs.forEach((ayah, index) => {
    assert(ayah.ayah === index + 1, `${reciterId}:${chapter.chapter}: non-contiguous ayah timing`);
    assert(Number.isInteger(ayah.startMs) && Number.isInteger(ayah.endMs), `${reciterId}:${chapter.chapter}:${ayah.ayah}: non-integer timing`);
    assert(ayah.startMs >= previousEnd && ayah.endMs > ayah.startMs && ayah.endMs <= chapter.durationMs, `${reciterId}:${chapter.chapter}:${ayah.ayah}: invalid timing range`);
    assert(/^[a-f0-9]{64}$/i.test(ayah.textSha256), `${reciterId}:${chapter.chapter}:${ayah.ayah}: invalid text digest`);
    previousEnd = ayah.endMs;
  });
}

async function main() {
  const library = await readJson(libraryPath);
  assert(library.format === "dalil-audio-library/v1", "unsupported library manifest format");
  assert(Array.isArray(library.reciters), "reciters must be an array");
  const ids = new Set();

  for (const entry of library.reciters) {
    assert(!ids.has(entry.id), `duplicate reciter id: ${entry.id}`);
    ids.add(entry.id);
    assert(entry.coverage === "verified-ayah-timings", `${entry.id}: unsupported coverage claim`);
    assert(entry.status === "published", `${entry.id}: only published manifests may be listed`);
    const manifestPath = path.join(root, entry.manifestPath);
    const manifest = await readJson(manifestPath);
    assert(manifest.format === "dalil-audio-reciter/v1", `${entry.id}: unsupported reciter format`);
    assert(manifest.reciter?.id === entry.id, `${entry.id}: manifest identifier mismatch`);
    assert(manifest.reciter?.license?.name && manifest.reciter?.license?.url && manifest.reciter?.license?.attribution, `${entry.id}: missing license attribution`);
    assert(Array.isArray(manifest.chapters) && manifest.chapters.length > 0, `${entry.id}: no chapter data`);
    manifest.chapters.forEach((chapter) => validateTimings(entry.id, chapter));
  }

  const reciterRoot = path.join(root, "reciters");
  const folders = await readdir(reciterRoot, { withFileTypes: true }).catch(() => []);
  console.log(`Validated ${library.reciters.length} published reciter manifest(s); ${folders.filter((entry) => entry.isDirectory()).length} reciter folder(s) present.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
