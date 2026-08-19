import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const tableCount = Number(process.argv[2] || 2300);
const output = resolve(process.argv[3] || "work/large-schema.sql");
const statements = [];

for (let index = 0; index < tableCount; index += 1) {
  const table = `business_table_${String(index).padStart(4, "0")}`;
  const parent = `business_table_${String(Math.max(0, index - 1)).padStart(4, "0")}`;
  const columns = [
    "  id BIGINT NOT NULL AUTO_INCREMENT",
    ...(index > 0 ? ["  parent_id BIGINT"] : []),
    "  tenant_id BIGINT NOT NULL",
    "  business_code VARCHAR(64) NOT NULL",
    "  business_name VARCHAR(160) NOT NULL",
    "  status TINYINT NOT NULL DEFAULT 1",
    "  category VARCHAR(40)",
    "  sort_order INT NOT NULL DEFAULT 0",
    "  amount DECIMAL(18,2) DEFAULT 0",
    "  payload JSON",
    "  note VARCHAR(500)",
    "  created_by BIGINT",
    "  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "  updated_by BIGINT",
    "  updated_at TIMESTAMP NULL",
    "  deleted TINYINT NOT NULL DEFAULT 0",
    "  version_no INT NOT NULL DEFAULT 1",
    "  source_system VARCHAR(40)",
    "  ext_1 VARCHAR(120)",
    "  ext_2 VARCHAR(120)",
    "  PRIMARY KEY (id)",
    "  KEY idx_tenant_status (tenant_id, status)",
    ...(index > 0
      ? [`  CONSTRAINT fk_${index}_parent FOREIGN KEY (parent_id) REFERENCES ${parent}(id)`]
      : []),
  ];
  statements.push(`CREATE TABLE ${table} (\n${columns.join(",\n")}\n) ENGINE=InnoDB;`);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${statements.join("\n\n")}\n`, "utf8");
console.log(`Generated ${tableCount} tables at ${output}`);
