import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const root = process.cwd();
const scanRoots = ["內容", "來源"];
const schemaDirectory = path.join(root, "結構定義");
const schemaFiles = [
  "共用內容.schema.json",
  "活動.schema.json",
  "攻略.schema.json",
  "版本.schema.json",
  "來源.schema.json",
  "實測紀錄.schema.json"
];

const schemaByType = new Map([
  ["event", "https://tms-maple-guide.local/schemas/event.schema.json"],
  ["guide", "https://tms-maple-guide.local/schemas/guide.schema.json"],
  ["version", "https://tms-maple-guide.local/schemas/version.schema.json"],
  ["source", "https://tms-maple-guide.local/schemas/source.schema.json"],
  ["test-record", "https://tms-maple-guide.local/schemas/test-record.schema.json"],
  ["system", "https://tms-maple-guide.local/schemas/common-content.schema.json"],
  ["glossary", "https://tms-maple-guide.local/schemas/common-content.schema.json"]
]);

const errors = [];
const warnings = [];
const pages = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md"
      ? [fullPath]
      : [];
  });
}

function relative(file) {
  return path.relative(root, file);
}

function readFrontMatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${relative(file)}：缺少 YAML Front Matter。`);
    return null;
  }

  try {
    const data = YAML.parse(match[1]);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      errors.push(`${relative(file)}：Front Matter 必須是物件。`);
      return null;
    }
    return data;
  } catch (error) {
    errors.push(`${relative(file)}：YAML 無法解析：${error.message}`);
    return null;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const filename of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, filename), "utf8"));
  ajv.addSchema(schema);
}

for (const scanRoot of scanRoots) {
  for (const file of walk(path.join(root, scanRoot))) {
    const data = readFrontMatter(file);
    if (data) pages.push({ file, data });
  }
}

for (const { file, data } of pages) {
  const schemaId = schemaByType.get(data.type);
  if (!schemaId) {
    errors.push(`${relative(file)}：目前沒有可用於 type「${data.type ?? "未填寫"}」的 Schema。`);
    continue;
  }

  const validate = ajv.getSchema(schemaId);
  if (!validate(data)) {
    for (const issue of validate.errors ?? []) {
      errors.push(`${relative(file)}${issue.instancePath || "/"}：${issue.message}`);
    }
  }

  if (data.type === "event") {
    const startsAt = Date.parse(data.starts_at);
    const endsAt = Date.parse(data.ends_at);
    if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt <= startsAt) {
      errors.push(`${relative(file)}：ends_at 必須晚於 starts_at。`);
    }
    if (data.claim_deadline) {
      const claimDeadline = Date.parse(data.claim_deadline);
      if (Number.isFinite(claimDeadline) && Number.isFinite(endsAt) && claimDeadline < endsAt) {
        warnings.push(`${relative(file)}：claim_deadline 早於 ends_at，請人工確認。`);
      }
    }

    const requirementIds = new Set();
    for (const requirement of data.completion_requirements ?? []) {
      if (requirementIds.has(requirement.id)) {
        errors.push(`${relative(file)}：達成條件 ID「${requirement.id}」重複。`);
      }
      requirementIds.add(requirement.id);
    }
    for (const rewardTier of data.reward_tiers ?? []) {
      for (const requirementId of rewardTier.requirement_ids ?? []) {
        if (!requirementIds.has(requirementId)) {
          errors.push(`${relative(file)}：獎勵「${rewardTier.id}」引用不存在的達成條件「${requirementId}」。`);
        }
      }
    }
  }
}

const idOwners = new Map();
for (const { file, data } of pages) {
  if (!data.id) continue;
  if (idOwners.has(data.id)) {
    errors.push(`${relative(file)}：ID「${data.id}」已由 ${relative(idOwners.get(data.id))} 使用。`);
  } else {
    idOwners.set(data.id, file);
  }
}

const sourceIds = new Set(
  pages.filter(({ data }) => data.type === "source").map(({ data }) => data.id)
);
for (const { file, data } of pages) {
  for (const sourceId of data.source_ids ?? []) {
    if (!sourceIds.has(sourceId)) {
      errors.push(`${relative(file)}：引用了不存在的來源 ID「${sourceId}」。`);
    }
  }
}

for (const warning of warnings) console.warn(`警告：${warning}`);
for (const error of errors) console.error(`錯誤：${error}`);

if (errors.length > 0) {
  console.error(`\n驗證失敗：${errors.length} 個錯誤，${warnings.length} 個警告。`);
  process.exit(1);
}

console.log(`驗證完成：${pages.length} 篇正式頁面，0 個錯誤，${warnings.length} 個警告。`);
