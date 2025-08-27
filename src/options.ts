import { info } from '@actions/core'
import { minimatch } from 'minimatch'
import { TokenLimits } from './limits'

export class Options {
  debug: boolean
  disableReview: boolean
  disableReleaseNotes: boolean
  maxFiles: number
  reviewSimpleChanges: boolean
  reviewCommentLGTM: boolean
  pathFilters: PathFilter
  systemMessage: string
  anthropicLightModel: string
  anthropicHeavyModel: string
  anthropicModelTemperature: number
  anthropicRetries: number
  anthropicTimeoutMS: number
  anthropicConcurrencyLimit: number
  githubConcurrencyLimit: number
  lightTokenLimits: TokenLimits
  heavyTokenLimits: TokenLimits
  apiBaseUrl: string
  language: string
  suggestPrTitle: boolean

  constructor(
    debug: boolean,
    disableReview: boolean,
    disableReleaseNotes: boolean,
    maxFiles = '0',
    reviewSimpleChanges = false,
    reviewCommentLGTM = false,
    pathFilters: string[] | null = null,
    systemMessage = '',
    anthropicLightModel = 'claude-3-5-sonnet-latest',
    anthropicHeavyModel = 'claude-3-5-sonnet-latest',
    anthropicModelTemperature = '0.0',
    anthropicRetries = '3',
    anthropicTimeoutMS = '120000',
    anthropicConcurrencyLimit = '6',
    githubConcurrencyLimit = '6',
    apiBaseUrl = 'https://api.anthropic.com/v1',
    language = 'en-US',
    suggestPrTitle = false
  ) {
    this.debug = debug
    this.disableReview = disableReview
    this.disableReleaseNotes = disableReleaseNotes
    this.maxFiles = parseInt(maxFiles)
    this.reviewSimpleChanges = reviewSimpleChanges
    this.reviewCommentLGTM = reviewCommentLGTM
    this.pathFilters = new PathFilter(pathFilters)
    this.systemMessage = systemMessage
    this.anthropicLightModel = anthropicLightModel
    this.anthropicHeavyModel = anthropicHeavyModel
    this.anthropicModelTemperature = parseFloat(anthropicModelTemperature)
    this.anthropicRetries = parseInt(anthropicRetries)
    this.anthropicTimeoutMS = parseInt(anthropicTimeoutMS)
    this.anthropicConcurrencyLimit = parseInt(anthropicConcurrencyLimit)
    this.githubConcurrencyLimit = parseInt(githubConcurrencyLimit)
    this.lightTokenLimits = new TokenLimits(anthropicLightModel)
    this.heavyTokenLimits = new TokenLimits(anthropicHeavyModel)
    this.apiBaseUrl = apiBaseUrl
    this.language = language
    this.suggestPrTitle = suggestPrTitle
  }

  // print all options using core.info
  print(): void {
    info(`debug: ${this.debug}`)
    info(`disable_review: ${this.disableReview}`)
    info(`disable_release_notes: ${this.disableReleaseNotes}`)
    info(`max_files: ${this.maxFiles}`)
    info(`review_simple_changes: ${this.reviewSimpleChanges}`)
    info(`review_comment_lgtm: ${this.reviewCommentLGTM}`)
    info(`path_filters: ${this.pathFilters}`)
    info(`system_message: ${this.systemMessage}`)
    info(`anthropic_light_model: ${this.anthropicLightModel}`)
    info(`anthropic_heavy_model: ${this.anthropicHeavyModel}`)
    info(`anthropic_model_temperature: ${this.anthropicModelTemperature}`)
    info(`anthropic_retries: ${this.anthropicRetries}`)
    info(`anthropic_timeout_ms: ${this.anthropicTimeoutMS}`)
    info(`anthropic_concurrency_limit: ${this.anthropicConcurrencyLimit}`)
    info(`github_concurrency_limit: ${this.githubConcurrencyLimit}`)
    info(`summary_token_limits: ${this.lightTokenLimits.string()}`)
    info(`review_token_limits: ${this.heavyTokenLimits.string()}`)
    info(`api_base_url: ${this.apiBaseUrl}`)
    info(`language: ${this.language}`)
    info(`suggest_pr_title: ${this.suggestPrTitle}`)
  }

  checkPath(path: string): boolean {
    const ok = this.pathFilters.check(path)
    info(`checking path: ${path} => ${ok}`)
    return ok
  }
}

export class PathFilter {
  private readonly rules: Array<[string /* rule */, boolean /* exclude */]>

  constructor(rules: string[] | null = null) {
    this.rules = []
    if (rules != null) {
      for (const rule of rules) {
        const trimmed = rule?.trim()
        if (trimmed) {
          if (trimmed.startsWith('!')) {
            this.rules.push([trimmed.substring(1).trim(), true])
          } else {
            this.rules.push([trimmed, false])
          }
        }
      }
    }
  }

  check(path: string): boolean {
    if (this.rules.length === 0) {
      return true
    }

    let included = false
    let excluded = false
    let inclusionRuleExists = false

    for (const [rule, exclude] of this.rules) {
      if (minimatch(path, rule)) {
        if (exclude) {
          excluded = true
        } else {
          included = true
        }
      }
      if (!exclude) {
        inclusionRuleExists = true
      }
    }

    return (!inclusionRuleExists || included) && !excluded
  }
}

export class ModelOptions {
  model: string
  tokenLimits: TokenLimits

  constructor(model = 'gpt-3.5-turbo', tokenLimits: TokenLimits | null = null) {
    this.model = model
    if (tokenLimits != null) {
      this.tokenLimits = tokenLimits
    } else {
      this.tokenLimits = new TokenLimits(model)
    }
  }
}
