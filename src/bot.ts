import './fetch-polyfill'

import { info, setFailed, warning } from '@actions/core'
import { AIAgent, ExecutionEngine } from '@aigne/core'
import { ClaudeChatModel } from '@aigne/core/models/claude-chat-model.js'
import pRetry from 'p-retry'
import { ModelOptions, Options } from './options'

// define type to save message and thread ids
export interface Ids {
  messageId?: string
  threadId?: string
}

export class Bot {
  private readonly api: ClaudeChatModel | null = null
  private readonly options: Options
  private readonly modelOptions: ModelOptions

  constructor(options: Options, modelOptions: ModelOptions) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "'ANTHROPIC_API_KEY' environment variable is not available"
      )
    }

    this.options = options
    this.modelOptions = modelOptions
    this.api = new ClaudeChatModel({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: this.modelOptions.model,
      modelOptions: {
        temperature: this.options.anthropicModelTemperature
      }
    })
  }

  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    let res: [string, Ids] = ['', {}]
    try {
      res = await this.chat_(message, ids)
      return res
    } catch (e: unknown) {
      warning(`Failed to chat: ${e}, backtrace: ${(e as Error).stack}`)
      return res
    }
  }

  private readonly chat_ = async (
    message: string,
    // eslint-disable-next-line no-unused-vars
    ids: Ids
  ): Promise<[string, Ids]> => {
    // record timing
    const start = Date.now()
    if (!message) {
      return ['', {}]
    }

    let response: string = ''

    if (this.api != null) {
      const currentDate = new Date().toISOString().split('T')[0]
      const reviewAgent = AIAgent.from({
        name: 'Code Reviewer',
        outputKey: 'review',
        instructions: `${this.options.systemMessage}
Knowledge cutoff: ${this.modelOptions.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}
IMPORTANT: Entire response must be in the language with ISO code: ${this.options.language}`
      })
      const engine = new ExecutionEngine({ model: this.api })

      try {
        const result = await pRetry(() => engine.call(reviewAgent, message), {
          retries: this.options.anthropicRetries
        })
        response = result.review as string
      } catch (e: unknown) {
        info(
          `response: ${response}, failed to send message to anthropic: ${e}, backtrace: ${
            (e as Error).stack
          }`
        )
      }
      const end = Date.now()
      info(
        `anthropic sendMessage (including retries) response time: ${
          end - start
        } ms`
      )
    } else {
      setFailed('The Anthropic API is not initialized')
    }

    if (!response) {
      warning('anthropic response is null or empty')
    }

    // remove the prefix "with " in the response
    if (response.startsWith('with ')) {
      response = response.substring(5)
    }

    if (this.options.debug) {
      info(`anthropic responses: ${response}`)
    }

    const newIds: Ids = {
      messageId: '',
      threadId: ''
    }

    return [response, newIds]
  }
}
