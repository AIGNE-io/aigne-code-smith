import {
  getBooleanInput,
  getInput,
  getMultilineInput,
  setFailed,
  warning,
  debug
} from '@actions/core'
import { Bot } from './bot'
import { ModelOptions, Options } from './options'
import { Prompts } from './prompts'
import { codeReview } from './review'
import { handleReviewComment } from './review-comment'

async function run(): Promise<void> {
  const options: Options = new Options(
    getBooleanInput('debug'),
    getBooleanInput('disable_review'),
    getBooleanInput('disable_release_notes'),
    getInput('max_files'),
    getBooleanInput('review_simple_changes'),
    getBooleanInput('review_comment_lgtm'),
    getMultilineInput('path_filters'),
    getInput('system_message'),
    getInput('anthropic_light_model'),
    getInput('anthropic_heavy_model'),
    getInput('anthropic_model_temperature'),
    getInput('anthropic_retries'),
    getInput('anthropic_timeout_ms'),
    getInput('anthropic_concurrency_limit'),
    getInput('github_concurrency_limit'),
    getInput('anthropic_base_url'),
    getInput('language'),
    getBooleanInput('suggest_pr_title')
  )

  // print options
  options.print()

  const prompts: Prompts = new Prompts(
    getInput('summarize'),
    getInput('summarize_release_notes'),
    getInput('suggest_pr_title_prompt')
  )

  // Create two bots, one for summary and one for review

  let lightBot: Bot | null = null
  try {
    lightBot = new Bot(
      options,
      new ModelOptions(options.anthropicLightModel, options.lightTokenLimits)
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create summary bot, please check your anthropic_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  let heavyBot: Bot | null = null
  try {
    heavyBot = new Bot(
      options,
      new ModelOptions(options.anthropicHeavyModel, options.heavyTokenLimits)
    )
  } catch (e: any) {
    warning(
      `Skipped: failed to create review bot, please check your anthropic_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  try {
    // check if the event is pull_request
    if (
      process.env.GITHUB_EVENT_NAME === 'pull_request' ||
      process.env.GITHUB_EVENT_NAME === 'pull_request_target'
    ) {
      options.debug && debug(`Running code review`)
      await codeReview(lightBot, heavyBot, options, prompts)
    } else if (
      process.env.GITHUB_EVENT_NAME === 'pull_request_review_comment'
    ) {
      options.debug && debug(`Running review comment`)
      await handleReviewComment(heavyBot, options, prompts)
    } else {
      warning('Skipped: this action only works on push events or pull_request')
    }
  } catch (e: any) {
    if (e instanceof Error) {
      setFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`)
    } else {
      setFailed(`Failed to run: ${e}, backtrace: ${e.stack}`)
    }
  }
}

process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

run()
