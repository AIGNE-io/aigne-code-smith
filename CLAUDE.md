# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

AIGNE CodeSmith is a GitHub Action that provides AI-powered code review and PR
summarization using Anthropic's Claude models. It's built with TypeScript and
integrates with the AIGNE framework for AI agent orchestration.

## Build and Development Commands

### Essential Commands

- `npm run build` - Compile TypeScript and copy WASM files to dist/
- `npm run package` - Bundle with ncc for distribution
- `npm run all` - Complete build pipeline: clean, build, format, lint, package,
  test
- `npm test` - Run Jest tests
- `npm run lint` - Run ESLint on TypeScript files
- `npm run format` - Format code with Prettier
- `npm run format-check` - Check code formatting

### Testing Commands

- `npm test` - Run all Jest tests (configured in jest.config.json)
- Tests are located in `__tests__/` directory with `.test.ts` extension

### Local Testing

- `npm run act` - Test GitHub Action locally using act (requires .secrets file)

## Architecture Overview

### Core Components

- **Bot** (`src/bot.ts`) - Wraps Anthropic API with AIGNE framework for AI agent
  interactions
- **Main** (`src/main.ts`) - Entry point handling GitHub Action inputs and
  orchestrating review workflow
- **Review** (`src/review.ts`) - Core PR review logic and file processing
- **Commenter** (`src/commenter.ts`) - GitHub API interactions for posting
  comments
- **Options** (`src/options.ts`) - Configuration and input validation

### Key Architecture Patterns

- Uses AIGNE framework (`@aigne/core`, `@aigne/anthropic`) for AI agent
  orchestration
- Dual-bot architecture: light model for summaries, heavy model for detailed
  reviews
- Retry logic with `p-retry` for API reliability
- GitHub Actions integration with `@actions/core` and `@actions/github`
- Token counting and limits management via `@dqbd/tiktoken`

### File Structure

- `src/` - TypeScript source code
- `lib/` - Compiled JavaScript (gitignored in development)
- `dist/` - Bundled distribution files for GitHub Action
- `__tests__/` - Jest test files

## Environment Variables

Required:

- `ANTHROPIC_API_KEY` - Anthropic API key for Claude models
- `GITHUB_TOKEN` - GitHub token for API access

Optional:

- `ANTHROPIC_API_ORG` - Anthropic organization (if using multiple)

## Model Configuration

Default models:

- Light model: `claude-3-5-sonnet-latest` (for summaries)
- Heavy model: `claude-3-5-sonnet-latest` (for detailed reviews)

Models can be configured via action inputs `anthropic_light_model` and
`anthropic_heavy_model`.

## Build Pipeline

The build process involves:

1. TypeScript compilation (`tsc`)
2. Copy WASM files for tiktoken
3. Bundle with `@vercel/ncc` for single-file distribution
4. Output goes to `dist/index.js` for GitHub Action execution

## Key Dependencies

- `@aigne/core` - AI agent framework
- `@aigne/anthropic` - Anthropic integration for AIGNE
- `@actions/core`, `@actions/github` - GitHub Actions SDK
- `@dqbd/tiktoken` - Token counting (requires WASM file)
- `minimatch` - File pattern matching for path filters
- `p-retry` - Retry logic for API calls

## Development Notes

- Uses TypeScript with strict mode enabled
- ESLint configuration with GitHub plugin for best practices
- Prettier for code formatting
- Jest for testing with ts-jest transformer
- Distribution requires bundling due to GitHub Actions single-file requirement
