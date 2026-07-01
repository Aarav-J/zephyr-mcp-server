/**
 * Seed a test index database for development/testing.
 * Run: npx tsx scripts/seed-test-db.ts
 */
import { ZephyrDatabase, getCacheDir, FunctionRow, KconfigRow, DtBindingRow } from "../src/db.js";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const version = "v4.1.0-test";
const indexDir = join(getCacheDir(), version);
mkdirSync(indexDir, { recursive: true });

const dbPath = join(indexDir, "zephyr-index.db");
const db = new ZephyrDatabase(dbPath);
db.initialize();

// Seed sample functions
const functions: FunctionRow[] = [
  {
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
  },
  {
    name: "k_sem_give",
    signature: "void k_sem_give(struct k_sem *sem)",
    brief: "Give a semaphore.",
    description: "This routine gives sem, unlocking a thread waiting on it.",
    params: JSON.stringify([
      { name: "sem", type: "struct k_sem *", description: "Semaphore object." },
    ]),
    return_type: "void",
    return_desc: null,
    header: "include/zephyr/kernel.h",
    section: "Kernel / Semaphores",
    group_id: "semaphore",
  },
  {
    name: "k_sem_init",
    signature: "int k_sem_init(struct k_sem *sem, unsigned int initial_count, unsigned int limit)",
    brief: "Initialize a semaphore.",
    description: "Initialize a semaphore object with an initial count and a limit.",
    params: JSON.stringify([
      { name: "sem", type: "struct k_sem *", description: "Semaphore object." },
      { name: "initial_count", type: "unsigned int", description: "Initial semaphore count." },
      { name: "limit", type: "unsigned int", description: "Maximum semaphore count." },
    ]),
    return_type: "int",
    return_desc: "0 on success, -EINVAL on bad args.",
    header: "include/zephyr/kernel.h",
    section: "Kernel / Semaphores",
    group_id: "semaphore",
  },
  {
    name: "GPIO_DT_SPEC_GET",
    signature: "#define GPIO_DT_SPEC_GET(node_id, flags)",
    brief: "Get a struct gpio_dt_spec from a devicetree node.",
    description: "This macro returns a gpio_dt_spec initialized from a devicetree node.",
    params: JSON.stringify([
      { name: "node_id", type: "devicetree node identifier", description: "DT node identifier." },
      { name: "flags", type: "gpio_flags_t", description: "GPIO configuration flags." },
    ]),
    return_type: "struct gpio_dt_spec",
    return_desc: "A gpio_dt_spec initialized from the devicetree node.",
    header: "include/zephyr/dt-bindings/gpio/gpio.h",
    section: "Devicetree / GPIO",
    group_id: "gpio",
  },
  {
    name: "device_get_binding",
    signature: "struct device *device_get_binding(const char *name)",
    brief: "Get a device handle by name.",
    description: "Returns a pointer to the device object for the driver with the given name.",
    params: JSON.stringify([
      { name: "name", type: "const char *", description: "Device name." },
    ]),
    return_type: "struct device *",
    return_desc: "Pointer to device, or NULL if not found.",
    header: "include/zephyr/device.h",
    section: "Device Driver Model / Core",
    group_id: "device",
  },
];

// Seed Kconfig symbols
const kconfigs: KconfigRow[] = [
  {
    name: "CONFIG_GPIO",
    type: "bool",
    prompt: "GPIO support",
    default_val: "y",
    depends_on: JSON.stringify([]),
    select_list: null,
    range_min: null,
    range_max: null,
    help_text: "Enable GPIO driver support.",
    path: "drivers/gpio/Kconfig",
  },
  {
    name: "CONFIG_I2C",
    type: "bool",
    prompt: "I2C support",
    default_val: "n",
    depends_on: JSON.stringify([]),
    select_list: null,
    range_min: null,
    range_max: null,
    help_text: "Enable I2C driver support.",
    path: "drivers/i2c/Kconfig",
  },
  {
    name: "CONFIG_I2C_STM32",
    type: "bool",
    prompt: "STM32 I2C driver",
    default_val: "n",
    depends_on: JSON.stringify(["CONFIG_I2C"]),
    select_list: null,
    range_min: null,
    range_max: null,
    help_text: "Enable STM32 I2C controller driver.",
    path: "drivers/i2c/Kconfig.stm32",
  },
];

// Seed DT bindings
const dtBindings: DtBindingRow[] = [
  {
    compatible: "st,stm32-gpio",
    description: "STM32 GPIO controller",
    properties: JSON.stringify({
      reg: { type: "array", required: true, description: "MMIO register range" },
      clocks: { type: "phandle-array", required: true },
      "gpio-controller": { type: "boolean", required: true },
      "#gpio-cells": { type: "int", required: true, const: 2 },
    }),
    child_binding: null,
    bus: "gpio",
    on_bus: "apb",
    path: "dts/bindings/gpio/st,stm32-gpio.yaml",
  },
  {
    compatible: "st,stm32-i2c",
    description: "STM32 I2C controller",
    properties: JSON.stringify({
      reg: { type: "array", required: true, description: "MMIO register range" },
      clocks: { type: "phandle-array", required: true },
      interrupts: { type: "array", required: true },
    }),
    child_binding: null,
    bus: "i2c",
    on_bus: "apb",
    path: "dts/bindings/i2c/st,stm32-i2c.yaml",
  },
];

db.insertFunctionsBatch(functions);
db.insertKconfigsBatch(kconfigs);
db.insertDtBindingsBatch(dtBindings);
db.rebuildFts();
db.setMeta("version", version);

// Write a meta file for easier inspection
writeFileSync(join(indexDir, "meta.json"), JSON.stringify({ version, count: functions.length }, null, 2));

db.close();

console.log(`Seeded ${functions.length} functions, ${kconfigs.length} Kconfigs, ${dtBindings.length} DT bindings`);
console.log(`Index path: ${dbPath}`);
