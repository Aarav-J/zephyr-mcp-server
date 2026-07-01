/**
 * Quick test for the SQLite database layer.
 * Run: npx tsx src/test-db.ts
 */
import { ZephyrDatabase, getCacheDir } from "./db.js";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

const testPath = join(getCacheDir(), "test.db");
for (const f of [testPath, testPath + "-wal", testPath + "-shm"]) {
  if (existsSync(f)) unlinkSync(f);
}

const db = new ZephyrDatabase(testPath);
db.initialize();

// Seed test data with all required fields
db.insertFunction({
  name: "k_sem_take",
  signature: "int k_sem_take(struct k_sem *sem, k_timeout_t timeout)",
  brief: "Take a semaphore, pend if not available.",
  description: "This routine takes sem, waiting if needed up to timeout units of time.",
  params: JSON.stringify([
    { name: "sem", type: "struct k_sem *", description: "Semaphore object." },
    { name: "timeout", type: "k_timeout_t", description: "Timeout value." },
  ]),
  return_type: "int",
  return_desc: "0 on success, -EAGAIN on timeout, -EINVAL on bad args.",
  header: "include/zephyr/kernel.h",
  section: "Kernel / Semaphores",
  group_id: "semaphore",
});

db.insertFunction({
  name: "k_sem_give",
  signature: "void k_sem_give(struct k_sem *sem)",
  brief: "Give a semaphore.",
  description: null,
  params: JSON.stringify([
    { name: "sem", type: "struct k_sem *", description: "Semaphore object." },
  ]),
  return_type: "void",
  return_desc: null,
  header: "include/zephyr/kernel.h",
  section: "Kernel / Semaphores",
  group_id: "semaphore",
});

db.insertKconfig({
  name: "CONFIG_GPIO",
  type: "bool",
  prompt: "GPIO support",
  default_val: null,
  depends_on: JSON.stringify([]),
  select_list: null,
  range_min: null,
  range_max: null,
  help_text: null,
  path: "drivers/gpio/Kconfig",
});

db.insertDtBinding({
  compatible: "st,stm32-gpio",
  description: "STM32 GPIO controller",
  properties: JSON.stringify({
    reg: { type: "array", required: true, description: "MMIO register range" },
    clocks: { type: "phandle-array", required: true },
  }),
  child_binding: null,
  bus: "gpio",
  on_bus: null,
  path: "dts/bindings/gpio/st,stm32-gpio.yaml",
});

db.insertDocChunk({
  title: "Semaphores",
  heading_path: "Kernel / Synchronization / Semaphores",
  body: "Semaphores are a standard locking pattern. Use k_sem_init() to initialize, k_sem_take() to acquire, and k_sem_give() to release.",
  source_url: "https://docs.zephyrproject.org/latest/kernel/services/synchronization/semaphores.html",
  domain: "guide",
});

db.rebuildFts();

// Test queries
let passed = 0;
let failed = 0;

function check(desc: string, ok: boolean) {
  if (ok) { passed++; console.log(`  \u2713 ${desc}`); }
  else { failed++; console.log(`  \u2717 ${desc}`); }
}

const fn = db.getFunctionByName("k_sem_take");
check("getFunctionByName returns result", fn !== undefined);
check("correct name", fn?.name === "k_sem_take");
check("correct signature", fn?.signature === "int k_sem_take(struct k_sem *sem, k_timeout_t timeout)");
check("has params", fn?.params !== null && fn?.params !== undefined);
check("has header", fn?.header === "include/zephyr/kernel.h");

const results = db.searchFunctions("k_sem");
check("searchFunctions returns 2 results", results.length === 2);

const kres = db.searchKconfig("CONFIG_GPIO");
check("searchKconfig returns GPIO", kres.length >= 1 && kres[0]?.name === "CONFIG_GPIO");

const dres = db.searchBindings("stm32");
check("searchBindings returns stm32", dres.length >= 1 && dres[0]?.compatible === "st,stm32-gpio");

const docRes = db.searchDocs("semaphore");
check("searchDocs returns semaphore docs", docRes.length >= 1);
if (docRes.length > 0) {
  check("doc result has correct title", docRes[0]?.title === "Semaphores");
}

// Meta
db.setMeta("version", "v4.1.0");
check("getMeta returns stored version", db.getMeta("version") === "v4.1.0");

db.close();

// Cleanup
for (const f of [testPath, testPath + "-wal", testPath + "-shm"]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
