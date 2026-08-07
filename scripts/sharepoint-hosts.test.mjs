// Adversarial tests for the SharePoint host allowlist
// (src/sources/sharepoint-hosts.ts), ported from team-pulse's
// sharepoint-hosts.test.ts.
//
// This repo has no test framework (deliberately — it's a small SPA), so this
// script compiles the one dependency-free module with the repo's existing
// tsc, imports the real compiled output, and asserts with node:assert.
//
// Run: npm run test:sharepoint-hosts

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = mkdtempSync(join(tmpdir(), "sharepoint-hosts-test-"))

let passed = 0
let failed = 0

try {
  // Compile just the module under test (it has no imports of its own).
  execFileSync(
    "npx",
    [
      "tsc",
      "src/sources/sharepoint-hosts.ts",
      "--outDir", outDir,
      "--module", "esnext",
      "--target", "es2022",
      "--strict",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  )
  // The temp dir is outside the repo's `"type": "module"` scope, so mark the
  // emitted ESM as such for node.
  writeFileSync(join(outDir, "package.json"), JSON.stringify({ type: "module" }))

  const { SHAREPOINT_HOST_RE, isAllowedSharePointHost } = await import(
    pathToFileURL(join(outDir, "sharepoint-hosts.js")).href
  )

  const check = (name, fn) => {
    try {
      fn()
      passed++
      console.log(`  ok    ${name}`)
    } catch (err) {
      failed++
      console.error(`  FAIL  ${name}`)
      console.error(`        ${err.message}`)
    }
  }

  const allowed = (host) => {
    assert.equal(SHAREPOINT_HOST_RE.test(host), true, `expected ALLOWED: ${host}`)
    assert.equal(isAllowedSharePointHost(host), true, `expected ALLOWED: ${host}`)
  }
  const rejected = (host) => {
    assert.equal(SHAREPOINT_HOST_RE.test(host), false, `expected REJECTED: ${host}`)
    assert.equal(isAllowedSharePointHost(host), false, `expected REJECTED: ${host}`)
  }

  console.log("SHAREPOINT_HOST_RE / isAllowedSharePointHost")

  check("accepts the standard production host", () => {
    allowed("microsoft-my.sharepoint.com")
    allowed("contoso.sharepoint.com")
  })

  check("accepts the dogfood ring host", () => {
    allowed("microsoft-my.sharepoint-df.com")
  })

  check("accepts sovereign/national cloud variants", () => {
    allowed("contoso.sharepoint.us") // GCC-High/DoD
    allowed("contoso.sharepoint.de") // Germany
    allowed("contoso.sharepoint.cn") // China
  })

  check("accepts the dogfood ring combined with a sovereign TLD", () => {
    allowed("contoso.sharepoint-df.us")
  })

  check("is case-insensitive", () => {
    allowed("Microsoft-My.SharePoint-DF.COM")
  })

  check("rejects a bare sharepoint domain with no tenant prefix", () => {
    rejected("sharepoint.com")
    rejected("sharepoint-df.com")
  })

  check("rejects an unsupported TLD", () => {
    rejected("contoso.sharepoint.io")
    rejected("contoso.sharepoint.net")
  })

  check("rejects a malformed dogfood-ring-like suffix", () => {
    rejected("contoso.sharepoint-dfx.com")
    rejected("contoso.sharepointdf.com")
  })

  check("rejects a host that merely contains 'sharepoint' as a substring (security case)", () => {
    rejected("evil-sharepoint.com.attacker.net")
    rejected("sharepoint.com.evil.com")
    rejected("evilsharepoint.com")
    rejected("notsharepoint.com")
  })

  check("rejects trailing-garbage / prefix-only tricks (anchoring check)", () => {
    rejected("contoso.sharepoint.com.attacker.net")
    rejected("attacker.net/contoso.sharepoint.com")
    rejected("contoso.sharepoint.com ")
    rejected("contoso.sharepoint.com\n")
    rejected("contoso.sharepoint.com\nevil.com")
  })

  check("rejects query-string smuggling of the suffix", () => {
    rejected("evil.com?x=.sharepoint.com")
    rejected("evil.com/.sharepoint.com")
  })

  check("rejects empty and junk input", () => {
    rejected("")
    rejected(".")
    rejected(".sharepoint.com")
  })
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
