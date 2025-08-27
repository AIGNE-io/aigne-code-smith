# Release Scripts for AIGNE CodeSmith

This directory contains automated release scripts for the AIGNE CodeSmith GitHub Action.

## 📋 Overview

The release process automates:
- ✅ Version bumping in `package.json`
- ✅ TypeScript compilation and bundling
- ✅ Code linting and formatting checks
- ✅ Git tagging with semantic versions
- ✅ GitHub release creation with auto-generated changelogs
- ✅ Major version tag updates for GitHub Actions marketplace

## 🚀 Quick Start

### Using npm scripts (Recommended)

```bash
# Patch release (0.1.0 -> 0.1.1)
npm run release:patch

# Minor release (0.1.0 -> 0.2.0)
npm run release:minor

# Major release (0.1.0 -> 1.0.0)
npm run release:major

# Custom version
npm run release custom 1.5.0-beta.1
```

### Using the scripts directly

```bash
# Node.js version (cross-platform)
node scripts/release.js patch
./scripts/release.js minor

# Bash version (Unix/Linux/macOS)
./scripts/release.sh patch
./scripts/release.sh major
```

## 📦 What Gets Released

The release process creates:

1. **Git Tag**: `v{version}` (e.g., `v0.2.0`)
2. **Major Tag**: `v{major}` (e.g., `v0`) - for GitHub Actions marketplace
3. **Latest Tag**: `latest` - always points to the most recent release
4. **GitHub Release**: With auto-generated changelog
5. **Updated Files**:
   - `package.json` - version bump
   - `dist/index.js` - bundled action code
   - `dist/` - all distribution files

## 🔧 Prerequisites

Ensure you have:

- [x] **Node.js** (v16+)
- [x] **npm** 
- [x] **Git** (configured with credentials)
- [x] **GitHub CLI** (`gh`) - authenticated
- [x] **Clean working directory** (no uncommitted changes)
- [x] **Main branch** (`master`) checked out

### Installing GitHub CLI

```bash
# macOS
brew install gh

# Windows
winget install GitHub.CLI

# Linux
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh
```

### Authenticating GitHub CLI

```bash
gh auth login
```

## 📋 Release Process Details

### 1. Pre-flight Checks
- Verifies all dependencies are installed
- Ensures you're on the `master` branch
- Checks that working directory is clean
- Validates version format (semantic versioning)

### 2. Build Process
```bash
npm run build      # TypeScript compilation + WASM copy
npm run package    # ncc bundling 
npm run lint       # ESLint checks
npm run format-check # Prettier formatting
```

### 3. Version Management
- Updates `package.json` version
- Creates commit with standardized message
- Tags commit with `v{version}`
- Updates major version tag (e.g., `v1` points to latest `v1.x.x`)

### 4. Release Creation
- Generates changelog from git commits since last tag
- Creates GitHub release with auto-generated notes
- Pushes all changes and tags to remote

## 🔄 Semantic Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.0.0`): Breaking changes
- **MINOR** (`0.1.0`): New features, backward compatible
- **PATCH** (`0.0.1`): Bug fixes, backward compatible

### Version Examples

```bash
# From 0.1.0:
npm run release:patch  # -> 0.1.1
npm run release:minor  # -> 0.2.0  
npm run release:major  # -> 1.0.0

# Custom versions:
npm run release custom 1.0.0-alpha.1
npm run release custom 2.0.0-rc.1
```

## 📝 Changelog Generation

Changelogs are auto-generated from git commit messages since the last release:

- Filters out merge commits
- Excludes `chore: rebuild release` commits  
- Uses commit subject lines as changelog entries
- Adds release date automatically

### Commit Message Best Practices

For better changelogs, use conventional commit format:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve issue with X"
git commit -m "docs: update README"
git commit -m "chore: update dependencies"
```

## 🛠 Troubleshooting

### Common Issues

**"Working directory is not clean"**
```bash
git status
git stash  # or commit changes
```

**"Must be on master branch"**
```bash
git checkout master
```

**"GitHub CLI not authenticated"** 
```bash
gh auth login
```

**"Build failed"**
```bash
npm run lint      # Check for linting errors
npm run build     # Check TypeScript compilation
npm run package   # Check ncc bundling
```

**"Permission denied"**
```bash
chmod +x scripts/release.sh
chmod +x scripts/release.js
```

### Debug Mode

For debugging, you can run individual steps:

```bash
# Test the build process
npm run all

# Check what would be in the changelog
git log --oneline $(git describe --tags --abbrev=0)..HEAD

# Verify GitHub CLI is working
gh auth status
gh repo view
```

## 🎯 GitHub Actions Marketplace

After release, the action can be used as:

```yaml
- uses: aigne-io/aigne-codesmith@latest    # Always latest release (recommended for testing)
- uses: aigne-io/aigne-codesmith@v1        # Latest v1.x.x (recommended for production)
- uses: aigne-io/aigne-codesmith@v1.2.0    # Specific version (most stable)
- uses: aigne-io/aigne-codesmith@v1.2      # Latest v1.2.x
```

The release process automatically maintains:
- **`latest`** tag - Always points to the most recent release across all versions
- **Major version tags** (`v1`, `v2`, etc.) - Point to the latest release in that major version

## 🔒 Security

- Scripts validate all inputs and dependencies
- No credentials are logged or exposed
- Uses GitHub CLI for secure API access
- Follows GitHub's security best practices

## 📄 License

These scripts are part of AIGNE CodeSmith and released under the MIT License.