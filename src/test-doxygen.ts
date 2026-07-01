/**
 * Test the Doxygen XML parser against the fixture file.
 * Run: npx tsx src/test-doxygen.ts
 */
import { parseDoxygenFile } from "./parsers/doxygen.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "test", "fixtures", "doxygen-group-semaphore.xml");

let passed = 0;
let failed = 0;

function check(desc: string, ok: boolean) {
  if (ok) { passed++; console.log(`  \u2713 ${desc}`); }
  else { failed++; console.log(`  \u2717 ${desc}`); }
}

const result = parseDoxygenFile(fixturePath);
const fns = result.functions;

check("parsed functions", fns.length > 0);
check("found k_sem_init", fns.some((f) => f.name === "k_sem_init"));
check("found k_sem_take", fns.some((f) => f.name === "k_sem_take"));
check("found k_sem_give", fns.some((f) => f.name === "k_sem_give"));

const take = fns.find((f) => f.name === "k_sem_take")!;
check("k_sem_take has correct signature", take.signature === "int k_sem_take(struct k_sem *sem, k_timeout_t timeout)");
check("found k_sem_init", fns.some((f) => f.name === "k_sem_init") === true);
check("found k_sem_take", fns.some((f) => f.name === "k_sem_take") === true);
check("found k_sem_give", fns.some((f) => f.name === "k_sem_give") === true);
check("k_sem_take has header", take.header === "include/zephyr/kernel.h");
check("k_sem_take has group_id", take.group_id === "semaphore");

if (take.params) {
  const params = JSON.parse(take.params);
  check("k_sem_take has 2 params", params.length === 2);
  check("first param is sem", params[0].name === "sem");
  check("first param type", params[0].type === "struct k_sem *");
  check("second param is timeout", params[1].name === "timeout");
  check("second param type", params[1].type === "k_timeout_t");
}

check("k_sem_init has return_type int", fns.find((f) => f.name === "k_sem_init")?.return_type === "int");
check("k_sem_give has return_type void", fns.find((f) => f.name === "k_sem_give")?.return_type === "void");

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
