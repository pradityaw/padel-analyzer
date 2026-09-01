# Devin Configuration for Padel Analyzer

This directory contains Devin-specific configuration for the padel-analyzer project.

## Skills

The following skills are available for this project:

1. **hallmark** - Anti-AI-slop design skill for UI work, audits, redesigns, and design extraction
2. **ui-design-system** - React UI component systems with TailwindCSS + Radix + shadcn/ui
3. **framer-motion-animator** - Creates smooth animations and micro-interactions using Framer Motion
4. **penpot-uiux-design** - Comprehensive guide for creating professional UI/UX designs in Penpot

## MCP Servers

The following MCP servers are configured:

1. **ghost** - PostgreSQL database management
2. **agent-device** - Physical iOS device verification (Swing Vision reference app)
3. **XcodeBuildMCP** - Xcode build integration
4. **shadcn** - shadcn/ui component library integration

## Project Context

This is a padel swing analysis application with:
- **Workstream A**: Client/analysis UX (React, MediaPipe, canvas)
- **Workstream B**: Server/data (Express, tRPC, SQLite)
- **Workstream C**: Tooling/PWA/docs (build, deploy, installability)
- **Workstream D**: ML Models (ONNX, inference, training)

See `AGENTS.md` in the project root for detailed workflow information.

## Design System

The project uses a locked "Tennis Neon" design system:
- Primary: padel-green `#a3e635` on slate `#0f172a`
- Accent: gold `#f59e0b` for PB/pro highlights
- Font: Geist Variable only
- See `design.md` for complete design system documentation

## Usage

When working on this project with Devin:
1. Use the `hallmark` skill for any UI design work
2. Use `ui-design-system` for component library work
3. Use `framer-motion-animator` for animations
4. Follow the workstream boundaries defined in AGENTS.md
5. Always read `design.md` before UI changes