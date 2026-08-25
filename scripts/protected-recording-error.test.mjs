// Classification tests for ProtectedRecordingError / isProtectedRecordingResponse
// (src/sources/protected-recording-error.ts).
//
// This repo has no test framework (deliberately — it's a small SPA), so this
// script compiles the one dependency-free module with the repo's existing
// tsc, imports the real compiled output, and asserts with node:assert.
// Mirrors scripts/sharepoint-hosts.test.mjs.
//
// Run: npm run test:protected-recording-error

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = mkdtempSync(join(tmpdir(), "protected-recording-error-test-"))

let passed = 0
let failed = 0

try {
  // Compile just the module under test (it has no imports of its own).
  execFileSync(
    "npx",
    [
      "tsc",
      "src/sources/protected-recording-error.ts",
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

  const { ProtectedRecordingError, isProtectedRecordingResponse } = await import(
    pathToFileURL(join(outDir, "protected-recording-error.js")).href
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

  const protectedResponse = (status, body) => {
    assert.equal(
      isProtectedRecordingResponse(status, body),
      true,
      `expected PROTECTED for ${status}: ${body}`,
    )
  }
  const notProtectedResponse = (status, body) => {
    assert.equal(
      isProtectedRecordingResponse(status, body),
      false,
      `expected NOT PROTECTED for ${status}: ${body}`,
    )
  }

  console.log("isProtectedRecordingResponse")

  check("classifies the real whitelist-gate 403 body as protected", () => {
    protectedResponse(
      403,
      '{"error":{"code":"accessDenied","message":"For protected mp4 file, this API is only supported for whitelisted apps, your app id 63231eb0-9b53-4342-8ac4-5209d618684e is not whitelisted."}}',
    )
  })

  check("is case-insensitive on the body match", () => {
    protectedResponse(403, "ACCESS DENIED: APP ID IS NOT WHITELISTED for this protected MP4 file")
  })

  check("matches on either signature phrase alone", () => {
    protectedResponse(403, "your app is not whitelisted")
    protectedResponse(403, "this is a protected mp4 resource")
  })

  check("rejects a 403 with an unrelated body (e.g. a plain permission/ACL denial)", () => {
    notProtectedResponse(403, '{"error":{"code":"accessDenied","message":"You do not have permission to view this item."}}')
    notProtectedResponse(403, "Forbidden")
    notProtectedResponse(403, "")
  })

  check("rejects a non-403 status even with the whitelist phrase present (status must match too)", () => {
    notProtectedResponse(401, "app id is not whitelisted")
    notProtectedResponse(500, "protected mp4 file")
    notProtectedResponse(400, "not whitelisted")
  })

  check("rejects other cross-cutting error shapes (cross-tenant, generic 5xx)", () => {
    notProtectedResponse(400, "Invalid hostname for this tenancy")
    notProtectedResponse(503, "Service unavailable")
  })

  console.log("\nProtectedRecordingError")

  check("carries the protectedRecording discriminant and a sensible default message", () => {
    const err = new ProtectedRecordingError()
    assert.equal(err.protectedRecording, true)
    assert.equal(err.name, "ProtectedRecordingError")
    assert.ok(err instanceof Error)
    assert.ok(err.message.length > 0)
  })

  check("accepts a custom message while keeping the discriminant", () => {
    const err = new ProtectedRecordingError("custom message")
    assert.equal(err.message, "custom message")
    assert.equal(err.protectedRecording, true)
  })
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
