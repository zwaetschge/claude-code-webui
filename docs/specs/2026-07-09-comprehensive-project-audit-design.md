# Comprehensive Project Audit and Repair Design

**Date:** 2026-07-09

**Status:** Approved for planning

## Objective

Audit the current `plum-code-webui` worktree across backend, frontend, shared
types, desktop packaging, provider integrations, Docker/deployment, security,
performance, accessibility, responsive behavior, and design-system
consistency. Reproduce and prioritize defects, repair every safely actionable
issue test-first, preserve existing uncommitted work, redeploy through the
Repair Bot when runtime code changes, and finish with automated and real-browser
evidence.

The audit cannot prove that unknown defects do not exist. Completion therefore
means that every defect discovered by the defined evidence sources is either
fixed and verified or documented as an external, non-actionable residual risk.
No reproducible critical or high-severity defect, failing required gate, or
material design inconsistency may remain open.

## Authoritative Project State

- The current uncommitted worktree is the product state under review. Existing
  modifications and untracked project files must be preserved.
- Destructive Git commands are prohibited. Unrelated existing changes must not
  be reformatted, reverted, or folded into a repair without evidence that they
  are part of the defect.
- Remote references must be fetched before integration decisions. The active
  branch must remain coherent with its configured upstream.
- `AGENTS.md` is authoritative for project instructions. `CLAUDE.md` remains a
  compatibility artifact and must not become the primary instruction source.
- Backend or Docker changes are deployed only with
  `bash scripts/plum-rebuild.sh`; the main container must never recreate itself
  directly with Docker Compose.

## Baseline Evidence

The pre-design baseline produced these reproducible results:

- Workspace TypeScript type checking passes.
- ESLint exits successfully with four React Hook warnings.
- Prettier checking fails on 35 files.
- The provider regression suite fails because PWA icon metadata contains only
  `purpose: "any"` while the regression requires a maskable icon declaration.
- Superpowers, design metadata, style previews, managed skills, project
  instructions, Docker, appearance theme, and operations-state regression
  suites pass independently.
- The public application route responds successfully after the latest Repair
  Bot rebuild.
- Local `main` matches `origin/main`, and the active
  `codex/integrate-superpowers` branch matches its upstream before audit edits.

These findings seed the issue ledger but do not limit the audit.

## Audit Architecture

### Wave 1: Repository and Verification Infrastructure

Inventory every package, executable script, build path, and existing test
suite. Add a deterministic root-level verification entry point so required
checks cannot silently remain unexecuted. Diagnose current build, typecheck,
lint, format, manifest, dependency, and regression failures. Formatting-only
noise is separated from behavioral fixes and applied only to files in scope or
as one explicitly reviewed formatting change.

### Wave 2: Backend and Provider Integrations

Trace API request boundaries, database writes, Socket.IO events, CLI process
lifecycle, streaming, resume/context reconstruction, provider switching,
permissions, token accounting, pricing, model discovery, usage limits, and
admin-LLM calls. Each provider is checked for lifecycle cleanup, timeout and
abort behavior, error propagation, cumulative-versus-turn usage handling, and
secret-safe diagnostics.

### Wave 3: Security and Configuration

Map trust boundaries for authentication, authorization, sessions, OAuth,
basic auth, file access, uploads, shell/process execution, MCP bridges,
webhooks, proxy users, Git operations, and settings persistence. Check input
type, length, format, path containment, command construction, output encoding,
secret redaction, secure defaults, headers, cookies, dependency advisories, and
least privilege. Security fixes must include negative regression cases for the
guard they introduce.

### Wave 4: Frontend, UX, and Design Consistency

Review the app shell, login/connect flow, dashboard, session workspace,
settings, analytics, files, operations, agents, and style library as distinct
product surfaces. Use source inspection plus the running application in the
system Chromium browser.

The browser matrix includes:

- desktop at 1440 x 900;
- mobile at 390 x 844;
- light, dark, and E-Ink themes where selectable;
- loading, empty, error, disabled, success, long-content, and destructive
  confirmation states where reachable;
- keyboard-only navigation, visible focus, semantic labels, contrast,
  reduced-motion behavior, clipping, overflow, and responsive layout.

Design discrepancies are measured against the existing local system rather
than a replacement aesthetic. The audit compares typography, spacing, radii,
color tokens, borders, elevation, icon sizing, control height, interaction
states, density, copy tone, and repeated component behavior. High-leverage
shared-token or shared-component corrections are preferred over page-specific
patches when they preserve intended behavior.

### Wave 5: Desktop, Docker, and Deployment

Build the Electron desktop package and validate its configuration boundaries.
Validate Dockerfiles, Compose variants, mounts, environment propagation,
healthchecks, startup scripts, installer behavior, MCP registration, and
Repair Bot triggering. Shell scripts receive syntax checks and targeted
regressions where behavior is safety-critical.

### Wave 6: Performance and Final Integration

Inspect frontend rerender warnings, unstable memo dependencies, oversized
assets or bundles, blocking backend operations, unbounded polling, resource
cleanup, duplicate work, and avoidable process spawning. Optimizations require
before-and-after evidence and must not trade correctness for speed.

After all repair waves, run the full verification matrix, perform the required
Repair Bot rebuild, and repeat live browser smoke tests against the rebuilt
application.

## Issue Triage and Repair Contract

Every accepted issue records:

1. affected surface and severity;
2. reproducible evidence and root cause;
3. expected behavior;
4. the smallest appropriate automated regression level;
5. the minimal production fix;
6. targeted and aggregate verification evidence;
7. remaining risk, if any.

Severity is assigned as follows:

- **Critical:** credential exposure, authentication bypass, destructive data
  loss, remote command execution, or application-wide outage.
- **High:** broken primary workflow, authorization failure, persistent data
  corruption, provider lifecycle failure, inaccessible primary interaction, or
  deployment failure.
- **Medium:** incorrect secondary behavior, misleading analytics, responsive
  breakage, significant design inconsistency, missing state handling, or
  material performance regression.
- **Low:** contained polish, maintainability, copy, or formatting issue without
  functional impact.

Repairs follow red-green TDD: reproduce with the smallest deterministic test,
confirm it fails for the intended reason, implement one root-cause fix, confirm
the test passes, then run the relevant aggregate gates. Three unsuccessful fix
hypotheses on one issue trigger an architecture review before further edits.

## Verification Matrix

Completion requires fresh evidence for all applicable checks:

- dependency installation consistency and lockfile integrity;
- workspace build and typecheck;
- ESLint with no errors and no unresolved actionable warnings;
- Prettier check;
- every backend and frontend regression script discovered in the repository;
- a root aggregate test command that invokes those suites;
- dependency advisory review with production-impact classification;
- Docker Compose configuration validation and shell syntax checks;
- backend/frontend/desktop build artifacts;
- live application response after a successful Repair Bot rebuild;
- authenticated primary-flow browser smoke tests where local credentials or an
  existing authenticated session make them reachable;
- desktop and mobile screenshots for reviewed user-facing surfaces;
- keyboard, focus, accessibility, responsive, theme, and state checks;
- a final Git diff audit proving existing unrelated work was preserved.

An unavailable external provider, expired third-party credential, absent real
device, or unreachable external service is not silently treated as success. It
must be isolated from local correctness, recorded with the exact missing
evidence, and retained as a residual risk unless it blocks a required local
workflow.

## Deliverables

- production fixes and regression tests in their owning packages;
- a deterministic aggregate verification command documented in project
  scripts;
- an evidence-based issue ledger summarizing discovered defects, root causes,
  fixes, verification, and residual risks;
- browser evidence for desktop and mobile design review;
- a final production UI score that observes the caps in the production review
  rubric;
- successful Repair Bot deployment evidence for backend or Docker changes;
- focused local commits that do not include unrelated pre-existing changes.

Pushing commits or rewriting remote history is outside this design unless the
user explicitly requests it. Fetching and maintaining coherent local tracking
references remains in scope.

## Completion Criteria

The goal is complete only when the current worktree satisfies the verification
matrix, all discovered safely actionable critical/high/medium defects are fixed,
low-severity defects are fixed unless doing so would alter unrelated user work,
no material design-system discrepancy remains on reviewed primary surfaces, the
rebuilt live application passes browser smoke checks, and every residual risk
is concrete, external or non-actionable, and documented with missing evidence.
