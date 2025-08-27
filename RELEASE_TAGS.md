# GitHub Action Tag Strategy

This document explains the tagging strategy used by AIGNE CodeSmith releases.

## 🏷️ Tag Types Created

Every release creates **3 types of tags**:

### 1. **Specific Version Tag** `v{major}.{minor}.{patch}`
- **Example**: `v1.2.3`
- **Purpose**: Points to exact release
- **Usage**: Most stable, never changes
- **Recommended for**: Production environments requiring reproducible builds

### 2. **Major Version Tag** `v{major}`
- **Example**: `v1` (points to latest `v1.x.x`)
- **Purpose**: Always points to latest release in that major version
- **Usage**: Gets bug fixes and minor updates automatically
- **Recommended for**: Production environments wanting automatic updates within major version

### 3. **Latest Tag** `latest`
- **Example**: `latest` (points to newest release across all versions)
- **Purpose**: Always points to the most recent release
- **Usage**: Gets all updates including major version changes
- **Recommended for**: Testing environments, development, early adopters

## 🎯 Usage Examples

```yaml
# In your .github/workflows/your-workflow.yml

jobs:
  review-pr:
    runs-on: ubuntu-latest
    steps:
      # Most stable - specific version (recommended for production)
      - uses: aigne-io/aigne-codesmith@v1.2.3
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

      # Stable with updates - major version (good for production)
      - uses: aigne-io/aigne-codesmith@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

      # Always latest - latest tag (good for testing/development)
      - uses: aigne-io/aigne-codesmith@latest
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## 📋 Tag Management

All tags are managed automatically by the release script:

```bash
# When you release v1.2.3, these tags are created/updated:
npm run release:patch

# Creates:
# - v1.2.3 (new specific version)
# Updates:
# - v1 (moves from v1.2.2 to v1.2.3)
# - latest (moves to v1.2.3 if it's the newest overall)
```

## 🔄 Tag Behavior During Releases

| Release Type | v1.2.2 → | Specific Tag | Major Tag | Latest Tag |
|-------------|-----------|-------------|-----------|------------|
| Patch | v1.2.3 | `v1.2.3` ← new | `v1` → v1.2.3 | `latest` → v1.2.3* |
| Minor | v1.3.0 | `v1.3.0` ← new | `v1` → v1.3.0 | `latest` → v1.3.0* |
| Major | v2.0.0 | `v2.0.0` ← new | `v2` ← new | `latest` → v2.0.0 |

*latest tag only updates if this is the newest release across all major versions

## 🚀 Benefits

- **Flexibility**: Choose your stability vs. freshness trade-off
- **Automatic Updates**: Major tags get security and bug fixes automatically
- **Rollback Safety**: Specific version tags never change
- **Testing**: Latest tag for trying new features
- **Production**: Major version tags for stable production use

## 🛡️ Security Considerations

- **Production**: Use major version tags (`@v1`) for automatic security updates
- **High Security**: Use specific tags (`@v1.2.3`) and update manually
- **Development**: Use `@latest` for newest features and fixes

## 📚 GitHub Actions Best Practices

This follows GitHub's recommended practices for action versioning:
- [GitHub Actions Versioning Guide](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)
- [Semantic Versioning](https://semver.org/)
- [Action Release Patterns](https://docs.github.com/en/actions/creating-actions/releasing-and-maintaining-actions)