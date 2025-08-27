import { info, warning } from '@actions/core'
// eslint-disable-next-line camelcase
import { context as github_context } from '@actions/github'
import { type Bot } from './bot'
import { Commenter, PR_TITLE_TAG } from './commenter'
import { Inputs } from './inputs'
import { type Options } from './options'
import { type Prompts } from './prompts'

// eslint-disable-next-line camelcase
const context = github_context

const lockFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'poetry.lock',
  'requirements.txt'
]

const isDependencyFile = (filename: string): boolean => {
  return lockFiles.some(lockFile => filename.endsWith(lockFile))
}

export const suggestPrTitle = async (
  lightBot: Bot,
  options: Options,
  prompts: Prompts,
  targetBranchDiff: any
): Promise<void> => {
  if (!options.suggestPrTitle) {
    return
  }

  const commenter: Commenter = new Commenter()

  if (
    context.eventName !== 'pull_request' &&
    context.eventName !== 'pull_request_target'
  ) {
    warning(
      `Skipped: current event is ${context.eventName}, only support pull_request event`
    )
    return
  }

  if (context.payload.pull_request == null) {
    warning('Skipped: context.payload.pull_request is null')
    return
  }

  const files = targetBranchDiff.data.files
  if (files == null || files.length === 0) {
    warning('Skipped: no files to analyze for PR title suggestion')
    return
  }

  // Filter out dependency lock files unless they are the only changes
  const nonDependencyFiles = files.filter(
    (file: any) => !isDependencyFile(file.filename)
  )
  const filesToAnalyze =
    nonDependencyFiles.length > 0 ? nonDependencyFiles : files

  // Create a consolidated diff from all files
  let consolidatedDiff = ''
  for (const file of filesToAnalyze) {
    if (file.patch) {
      consolidatedDiff += `--- ${file.filename}\n${file.patch}\n\n`
    }
  }

  if (consolidatedDiff.trim() === '') {
    warning('Skipped: no meaningful diff content for PR title suggestion')
    return
  }

  // Create inputs for the prompt
  const inputs: Inputs = new Inputs()
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body != null) {
    inputs.description = context.payload.pull_request.body
  }
  inputs.diff = consolidatedDiff

  info('Generating PR title suggestions...')

  try {
    // Generate PR title suggestions using light model
    const [titleResponse] = await lightBot.chat(
      prompts.renderSuggestPrTitle(inputs),
      {}
    )

    if (titleResponse === '') {
      warning('No PR title suggestions generated')
      return
    }

    // Format the comment with the suggestions
    const suggestionComment = `### 🏷️ Pull Request Title Suggestions

Based on the changes in this PR, here are 3 conventional commit style title suggestions:

${titleResponse}

---
*Feel free to use one of these suggestions or modify them to better fit your changes.*`

    // Post the suggestion comment
    await commenter.comment(suggestionComment, PR_TITLE_TAG, 'replace')

    info('PR title suggestions posted successfully')
  } catch (e: any) {
    warning(`Failed to generate PR title suggestions: ${e as string}`)
  }
}
