#!/usr/bin/env npx tsx
/**
 * Agent Health Check
 * Validates all agent .md files have valid YAML frontmatter, required fields,
 * and their memory files exist.
 */

import fs from "fs";
import path from "path";

const AGENTS_DIR = path.join(process.cwd(), ".claude/agents");
const MEMORY_DIR = path.join(process.cwd(), ".claude/memory");

const REQUIRED_FIELDS = ["name", "description", "tools", "model"];
const VALID_MODELS = ["opus", "sonnet", "haiku"];

interface AgentIssue {
  agent: string;
  severity: "error" | "warning";
  message: string;
}

function parseYamlFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml: Record<string, any> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    yaml[key] = value;
  }
  return yaml;
}

function checkAgent(filePath: string): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const filename = path.basename(filePath, ".md");
  const content = fs.readFileSync(filePath, "utf-8");

  // Check YAML frontmatter exists
  const frontmatter = parseYamlFrontmatter(content);
  if (!frontmatter) {
    issues.push({ agent: filename, severity: "error", message: "Missing YAML frontmatter" });
    return issues;
  }

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!frontmatter[field]) {
      issues.push({ agent: filename, severity: "error", message: `Missing required field: ${field}` });
    }
  }

  // Check valid model
  if (frontmatter.model && !VALID_MODELS.includes(frontmatter.model)) {
    issues.push({ agent: filename, severity: "error", message: `Invalid model: ${frontmatter.model}` });
  }

  // Check maxTurns
  if (!frontmatter.maxTurns) {
    issues.push({ agent: filename, severity: "warning", message: "No maxTurns set (defaults to unlimited)" });
  } else {
    const turns = parseInt(frontmatter.maxTurns);
    if (turns > 40) {
      issues.push({ agent: filename, severity: "warning", message: `maxTurns=${turns} is very high — consider reducing` });
    }
  }

  // Check memory file reference
  const memoryMatch = content.match(/\.claude\/memory\/([a-z0-9-]+\.md)/);
  if (memoryMatch) {
    const memoryFile = path.join(MEMORY_DIR, memoryMatch[1]);
    if (!fs.existsSync(memoryFile)) {
      issues.push({ agent: filename, severity: "error", message: `Memory file missing: ${memoryMatch[1]}` });
    }
  } else {
    issues.push({ agent: filename, severity: "warning", message: "No memory file referenced" });
  }

  // Check shared memory reference
  if (!content.includes("_shared.md")) {
    issues.push({ agent: filename, severity: "warning", message: "Does not reference _shared.md shared rules" });
  }

  // Check for guardrails section (optional but recommended for builders)
  const builderAgents = [
    "frontend-developer", "backend-developer", "parser-developer",
    "chrome-extension-agent", "migration-writer", "integration-specialist"
  ];
  if (builderAgents.includes(filename) && !content.includes("Guardrail")) {
    issues.push({ agent: filename, severity: "warning", message: "Builder agent missing Guardrails section" });
  }

  // Check body has content
  const body = content.replace(/^---\n[\s\S]*?\n---/, "").trim();
  if (body.length < 50) {
    issues.push({ agent: filename, severity: "warning", message: "Agent body is very short — may lack instructions" });
  }

  return issues;
}

// Run checks
console.log("🦆 Profit Duck Agent Health Check\n");

if (!fs.existsSync(AGENTS_DIR)) {
  console.error("❌ Agents directory not found:", AGENTS_DIR);
  process.exit(1);
}

const agentFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"));
console.log(`Found ${agentFiles.length} agents\n`);

let totalErrors = 0;
let totalWarnings = 0;
const allIssues: AgentIssue[] = [];

// Stats
const modelCounts: Record<string, number> = {};
const turnStats: number[] = [];

for (const file of agentFiles) {
  const filePath = path.join(AGENTS_DIR, file);
  const issues = checkAgent(filePath);
  allIssues.push(...issues);

  const content = fs.readFileSync(filePath, "utf-8");
  const fm = parseYamlFrontmatter(content);
  if (fm?.model) modelCounts[fm.model] = (modelCounts[fm.model] || 0) + 1;
  if (fm?.maxTurns) turnStats.push(parseInt(fm.maxTurns));
}

// Print issues grouped by agent
const issuesByAgent = new Map<string, AgentIssue[]>();
for (const issue of allIssues) {
  if (!issuesByAgent.has(issue.agent)) issuesByAgent.set(issue.agent, []);
  issuesByAgent.get(issue.agent)!.push(issue);
}

for (const [agent, issues] of issuesByAgent) {
  console.log(`📋 ${agent}`);
  for (const issue of issues) {
    const icon = issue.severity === "error" ? "  ❌" : "  ⚠️";
    console.log(`${icon} ${issue.message}`);
    if (issue.severity === "error") totalErrors++;
    else totalWarnings++;
  }
}

// Print clean agents
const cleanAgents = agentFiles
  .map(f => path.basename(f, ".md"))
  .filter(a => !issuesByAgent.has(a));

if (cleanAgents.length > 0) {
  console.log(`\n✅ Clean agents (${cleanAgents.length}): ${cleanAgents.join(", ")}`);
}

// Summary
console.log("\n" + "=".repeat(50));
console.log(`📊 Summary`);
console.log(`   Agents: ${agentFiles.length}`);
console.log(`   Errors: ${totalErrors}`);
console.log(`   Warnings: ${totalWarnings}`);
console.log(`   Models: ${Object.entries(modelCounts).map(([m, c]) => `${m}=${c}`).join(", ")}`);
if (turnStats.length > 0) {
  console.log(`   MaxTurns: min=${Math.min(...turnStats)}, max=${Math.max(...turnStats)}, avg=${Math.round(turnStats.reduce((a, b) => a + b, 0) / turnStats.length)}`);
}

// Check shared memory
const sharedMemory = path.join(MEMORY_DIR, "_shared.md");
if (fs.existsSync(sharedMemory)) {
  console.log(`   Shared memory: ✅ exists`);
} else {
  console.log(`   Shared memory: ❌ missing _shared.md`);
  totalErrors++;
}

console.log("\n" + (totalErrors === 0 ? "🎉 All agents healthy!" : `⚠️ ${totalErrors} errors need fixing`));
process.exit(totalErrors > 0 ? 1 : 0);
