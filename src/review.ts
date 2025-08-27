import { error, info, warning } from '@actions/core'
// eslint-disable-next-line camelcase
import { context as github_context } from '@actions/github'
import pLimit from 'p-limit'
import { type Bot } from './bot'
import {
  Commenter,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG
} from './commenter'
import { Inputs } from './inputs'
import { octokit } from './octokit'
import { type Options } from './options'
import { suggestPrTitle } from './pr-title-suggest'
import { type Prompts } from './prompts'
import { getTokenCount } from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

const ignoreKeyword = '@codesmith: ignore'

export const codeReview = async (
  lightBot: Bot,
  heavyBot: Bot,
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter: Commenter = new Commenter()

  const anthropicConcurrencyLimit = pLimit(options.anthropicConcurrencyLimit)
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit)

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

  const inputs: Inputs = new Inputs()
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body != null) {
    inputs.description = commenter.getDescription(
      context.payload.pull_request.body
    )
  }

  // if the description contains ignore_keyword, skip
  if (inputs.description.includes(ignoreKeyword)) {
    info('Skipped: description contains ignore_keyword')
    return
  }

  // as gpt-3.5-turbo isn't paying attention to system message, add to inputs for now
  inputs.systemMessage = options.systemMessage

  // get SUMMARIZE_TAG message
  const existingSummarizeCmt = await commenter.findCommentWithTag(
    SUMMARIZE_TAG,
    context.payload.pull_request.number
  )
  let existingCommitIdsBlock = ''
  let existingSummarizeCmtBody = ''
  if (existingSummarizeCmt != null) {
    existingSummarizeCmtBody = existingSummarizeCmt.body
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody)
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody)
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(
      existingSummarizeCmtBody
    )
  }

  const allCommitIds = await commenter.getAllCommitIds()
  // find highest reviewed commit id
  let highestReviewedCommitId = ''
  if (existingCommitIdsBlock !== '') {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(
      allCommitIds,
      commenter.getReviewedCommitIds(existingCommitIdsBlock)
    )
  }

  if (
    highestReviewedCommitId === '' ||
    highestReviewedCommitId === context.payload.pull_request.head.sha
  ) {
    info(
      `Will review from the base commit: ${
        context.payload.pull_request.base.sha as string
      }`
    )
    highestReviewedCommitId = context.payload.pull_request.base.sha
  } else {
    info(`Will review from commit: ${highestReviewedCommitId}`)
  }

  // Fetch the diff between the highest reviewed commit and the latest commit of the PR branch
  const incrementalDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: highestReviewedCommitId,
    head: context.payload.pull_request.head.sha
  })

  // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
  const targetBranchDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: context.payload.pull_request.base.sha,
    head: context.payload.pull_request.head.sha
  })

  // Generate PR title suggestions if enabled
  await suggestPrTitle(lightBot, options, prompts, targetBranchDiff)

  const incrementalFiles = incrementalDiff.data.files
  const targetBranchFiles = targetBranchDiff.data.files

  if (incrementalFiles == null || targetBranchFiles == null) {
    warning('Skipped: files data is missing')
    return
  }

  // Filter out any file that is changed compared to the incremental changes
  const files = targetBranchFiles.filter(targetBranchFile =>
    incrementalFiles.some(
      incrementalFile => incrementalFile.filename === targetBranchFile.filename
    )
  )

  if (files.length === 0) {
    warning('Skipped: files is null')
    return
  }

  // skip files if they are filtered out
  const filterSelectedFiles = []
  const filterIgnoredFiles = []
  for (const file of files) {
    if (!options.checkPath(file.filename)) {
      info(`skip for excluded path: ${file.filename}`)
      filterIgnoredFiles.push(file)
    } else {
      filterSelectedFiles.push(file)
    }
  }

  if (filterSelectedFiles.length === 0) {
    warning('Skipped: filterSelectedFiles is null')
    return
  }

  const commits = incrementalDiff.data.commits

  if (commits.length === 0) {
    warning('Skipped: commits is null')
    return
  }

  // find hunks to review
  const filteredFiles: Array<
    [string, string, string, Array<[number, number, string]>] | null
  > = await Promise.all(
    filterSelectedFiles.map(file =>
      githubConcurrencyLimit(async () => {
        // retrieve file contents
        let fileContent = ''
        if (context.payload.pull_request == null) {
          warning('Skipped: context.payload.pull_request is null')
          return null
        }
        try {
          const contents = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: file.filename,
            ref: context.payload.pull_request.base.sha
          })
          if (contents.data != null) {
            if (!Array.isArray(contents.data)) {
              if (
                contents.data.type === 'file' &&
                contents.data.content != null
              ) {
                fileContent = Buffer.from(
                  contents.data.content,
                  'base64'
                ).toString()
              }
            }
          }
        } catch (e: any) {
          warning(
            `Failed to get file contents: ${e as string} for ${
              file.filename
            }. This is OK if it's a new file.`
          )
        }

        let fileDiff = ''
        if (file.patch != null) {
          fileDiff = file.patch
        }

        const patches: Array<[number, number, string]> = []
        for (const patch of splitPatch(file.patch)) {
          const patchLines = patchStartEndLine(patch)
          if (patchLines == null) {
            continue
          }
          const hunks = parsePatch(patch)
          if (hunks == null) {
            continue
          }
          const hunksStr = `
---new_hunk---
\`\`\`
${hunks.newHunk}
\`\`\`

---old_hunk---
\`\`\`
${hunks.oldHunk}
\`\`\`
`
          patches.push([
            patchLines.newHunk.startLine,
            patchLines.newHunk.endLine,
            hunksStr
          ])
        }
        if (patches.length > 0) {
          return [file.filename, fileContent, fileDiff, patches] as [
            string,
            string,
            string,
            Array<[number, number, string]>
          ]
        } else {
          return null
        }
      })
    )
  )

  // Filter out any null results
  const filesAndChanges = filteredFiles.filter(file => file !== null) as Array<
    [string, string, string, Array<[number, number, string]>]
  >

  if (filesAndChanges.length === 0) {
    error('Skipped: no files to review')
    return
  }

  let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${
    context.payload.pull_request.head.sha
  } commits.
</details>
${
  filesAndChanges.length > 0
    ? `
<details>
<summary>Files selected (${filesAndChanges.length})</summary>

* ${filesAndChanges
        .map(([filename, , , patches]) => `${filename} (${patches.length})`)
        .join('\n* ')}
</details>
`
    : ''
}
${
  filterIgnoredFiles.length > 0
    ? `
<details>
<summary>Files ignored due to filter (${filterIgnoredFiles.length})</summary>

* ${filterIgnoredFiles.map(file => file.filename).join('\n* ')}

</details>
`
    : ''
}
`

  // update the existing comment with in progress status
  const inProgressSummarizeCmt = commenter.addInProgressStatus(
    existingSummarizeCmtBody,
    statusMsg
  )

  // add in progress status to the summarize comment
  await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, 'replace')

  const summariesFailed: string[] = []

  const doSummary = async (
    filename: string,
    fileContent: string,
    fileDiff: string
  ): Promise<[string, string, boolean] | null> => {
    info(`summarize: ${filename}`)
    const ins = inputs.clone()
    if (fileDiff.length === 0) {
      warning(`summarize: file_diff is empty, skip ${filename}`)
      summariesFailed.push(`${filename} (empty diff)`)
      return null
    }

    ins.filename = filename
    ins.fileDiff = fileDiff

    // render prompt based on inputs so far
    const summarizePrompt = prompts.renderSummarizeFileDiff(
      ins,
      options.reviewSimpleChanges
    )
    const tokens = getTokenCount(summarizePrompt)

    if (tokens > options.lightTokenLimits.requestTokens) {
      info(`summarize: diff tokens exceeds limit, skip ${filename}`)
      summariesFailed.push(`${filename} (diff tokens exceeds limit)`)
      return null
    }

    // summarize content
    try {
      const [summarizeResp] = await lightBot.chat(summarizePrompt, {})

      if (summarizeResp === '') {
        info('summarize: nothing obtained from anthropic')
        summariesFailed.push(`${filename} (nothing obtained from anthropic)`)
        return null
      } else {
        if (options.reviewSimpleChanges === false) {
          // parse the comment to look for triage classification
          // Format is : [TRIAGE]: <NEEDS_REVIEW or APPROVED>
          // if the change needs review return true, else false
          const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/
          const triageMatch = summarizeResp.match(triageRegex)

          if (triageMatch != null) {
            const triage = triageMatch[1]
            const needsReview = triage === 'NEEDS_REVIEW'

            // remove this line from the comment
            const summary = summarizeResp.replace(triageRegex, '').trim()
            info(`filename: ${filename}, triage: ${triage}`)
            return [filename, summary, needsReview]
          }
        }
        return [filename, summarizeResp, true]
      }
    } catch (e: any) {
      warning(`summarize: error from anthropic: ${e as string}`)
      summariesFailed.push(
        `${filename} (error from anthropic: ${e as string})})`
      )
      return null
    }
  }

  const summaryPromises = []
  const skippedFiles = []
  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
      summaryPromises.push(
        anthropicConcurrencyLimit(
          async () => await doSummary(filename, fileContent, fileDiff)
        )
      )
    } else {
      skippedFiles.push(filename)
    }
  }

  const summaries = (await Promise.all(summaryPromises)).filter(
    summary => summary !== null
  ) as Array<[string, string, boolean]>

  if (summaries.length > 0) {
    const batchSize = 10
    // join summaries into one in the batches of batchSize
    // and ask the bot to summarize the summaries
    for (let i = 0; i < summaries.length; i += batchSize) {
      const summariesBatch = summaries.slice(i, i + batchSize)
      for (const [filename, summary] of summariesBatch) {
        inputs.rawSummary += `---
${filename}: ${summary}
`
      }
      // ask chatgpt to summarize the summaries
      const [summarizeResp] = await heavyBot.chat(
        prompts.renderSummarizeChangesets(inputs),
        {}
      )
      if (summarizeResp === '') {
        warning('summarize: nothing obtained from anthropic')
      } else {
        inputs.rawSummary = summarizeResp
      }
    }
  }

  // final summary
  const [summarizeFinalResponse] = await heavyBot.chat(
    prompts.renderSummarize(inputs),
    {}
  )
  if (summarizeFinalResponse === '') {
    info('summarize: nothing obtained from anthropic')
  }

  if (options.disableReleaseNotes === false) {
    // final release notes
    const [releaseNotesResponse] = await heavyBot.chat(
      prompts.renderSummarizeReleaseNotes(inputs),
      {}
    )
    if (releaseNotesResponse === '') {
      info('release notes: nothing obtained from anthropic')
    } else {
      let message = '### Summary by AIGNE\n\n'
      message += releaseNotesResponse
      try {
        await commenter.updateDescription(
          context.payload.pull_request.number,
          message
        )
      } catch (e: any) {
        warning(`release notes: error from github: ${e.message as string}`)
      }
    }
  }

  // generate a short summary as well
  const [summarizeShortResponse] = await heavyBot.chat(
    prompts.renderSummarizeShort(inputs),
    {}
  )
  inputs.shortSummary = summarizeShortResponse

  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
`

  statusMsg += `
${
  skippedFiles.length > 0
    ? `
<details>
<summary>Files not processed due to max files limit (${
        skippedFiles.length
      })</summary>

* ${skippedFiles.join('\n* ')}

</details>
`
    : ''
}
${
  summariesFailed.length > 0
    ? `
<details>
<summary>Files not summarized due to errors (${
        summariesFailed.length
      })</summary>

* ${summariesFailed.join('\n* ')}

</details>
`
    : ''
}
`

  if (!options.disableReview) {
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview =
        summaries.find(
          ([summaryFilename]) => summaryFilename === filename
        )?.[2] ?? true
      return needsReview
    })

    const reviewsSkipped = filesAndChanges
      .filter(
        ([filename]) =>
          !filesAndChangesReview.some(
            ([reviewFilename]) => reviewFilename === filename
          )
      )
      .map(([filename]) => filename)

    // failed reviews array
    const reviewsFailed: string[] = []
    let lgtmCount = 0
    let reviewCount = 0

    // 处理大型 diff 的辅助函数
    const processLargeDiff = async (
      filename: string,
      fileContent: string,
      patches: Array<[number, number, string]>,
      ins: Inputs
    ): Promise<void> => {
      // 计算 tokens
      let tokens = getTokenCount(prompts.renderReviewFileDiff(ins))
      let patchesToPack = 0

      // 按照重要性对 patches 进行排序
      const patchesWithImportance = patches
        .map(([startLine, endLine, patch]) => {
          const { importance } = evaluatePatchImportance(patch)
          return { startLine, endLine, patch, importance }
        })
        .sort((a, b) => b.importance - a.importance) // 按重要性降序排序

      // 尽可能多地打包重要的 patches
      const selectedPatches: Array<[number, number, string]> = []
      for (const { startLine, endLine, patch } of patchesWithImportance) {
        const patchTokens = getTokenCount(patch)
        if (tokens + patchTokens <= options.heavyTokenLimits.requestTokens) {
          selectedPatches.push([startLine, endLine, patch])
          tokens += patchTokens
          // eslint-disable-next-line no-unused-vars
          patchesToPack += 1
        }
      }

      // 合并相邻的 patches
      const mergedPatches = mergePatchesIfNeeded(selectedPatches)

      // 添加到输入中
      for (const [, , patch] of mergedPatches) {
        ins.patches += `${patch}\n---patch_separator---\n`
      }

      // 执行审查
      try {
        const [response] = await heavyBot.chat(
          prompts.renderReviewFileDiff(ins),
          {}
        )
        if (response === '') {
          info('review: nothing obtained from anthropic')
          reviewsFailed.push(`${filename} (no response)`)
          return
        }

        const reviews = parseReview(response, patches, options.debug)
        for (const review of reviews) {
          if (
            !options.reviewCommentLGTM &&
            (review.comment.includes('LGTM') ||
              review.comment.includes('looks good to me'))
          ) {
            lgtmCount += 1
            continue
          }

          if (context.payload.pull_request == null) {
            warning('No pull request found, skipping.')
            continue
          }

          try {
            reviewCount += 1
            await commenter.bufferReviewComment(
              filename,
              review.startLine,
              review.endLine,
              `${review.comment}`
            )
          } catch (e: any) {
            reviewsFailed.push(`${filename} comment failed (${e as string})`)
          }
        }
      } catch (e: any) {
        warning(
          `Failed to review: ${e as string}, skipping. backtrace: ${
            e.stack as string
          }`
        )
        reviewsFailed.push(`${filename} (${e as string})`)
      }
    }

    const doReview = async (
      filename: string,
      fileContent: string,
      patches: Array<[number, number, string]>
    ): Promise<void> => {
      info(`reviewing ${filename}`)
      // make a copy of inputs
      const ins: Inputs = inputs.clone()
      ins.filename = filename

      // 获取整个文件的 diff
      const fullFileDiff = patches
        .sort((a, b) => a[0] - b[0]) // 按照开始行号排序
        .map(([, , patch]) => patch)
        .join('\n---patch_separator---\n')

      // 计算 tokens
      const baseTokens = getTokenCount(prompts.renderReviewFileDiff(ins))
      const diffTokens = getTokenCount(fullFileDiff)
      const totalTokens = baseTokens + diffTokens

      if (totalTokens > options.heavyTokenLimits.requestTokens) {
        info(
          `File diff too large (${totalTokens} tokens), splitting into smaller chunks`
        )
        // 如果整个文件的 diff 太大，回退到分块处理方式
        await processLargeDiff(filename, fileContent, patches, ins)
        return
      }

      // 将整个文件的 diff 添加到输入中
      ins.patches = fullFileDiff

      try {
        // 执行一次性代码审查
        const [response] = await heavyBot.chat(
          prompts.renderReviewFileDiff(ins),
          {}
        )

        if (response === '') {
          info('review: nothing obtained from anthropic')
          reviewsFailed.push(`${filename} (no response)`)
          return
        }

        // 解析审查结果
        const reviews = parseReview(response, patches, options.debug)
        for (const review of reviews) {
          if (
            !options.reviewCommentLGTM &&
            (review.comment.includes('LGTM') ||
              review.comment.includes('looks good to me'))
          ) {
            lgtmCount += 1
            continue
          }

          if (context.payload.pull_request == null) {
            warning('No pull request found, skipping.')
            continue
          }

          try {
            reviewCount += 1
            await commenter.bufferReviewComment(
              filename,
              review.startLine,
              review.endLine,
              `${review.comment}`
            )
          } catch (e: any) {
            reviewsFailed.push(`${filename} comment failed (${e as string})`)
          }
        }
      } catch (e: any) {
        warning(
          `Failed to review: ${e as string}, skipping. backtrace: ${
            e.stack as string
          }`
        )
        reviewsFailed.push(`${filename} (${e as string})`)
      }
    }

    const reviewPromises = []
    for (const [filename, fileContent, , patches] of filesAndChangesReview) {
      if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
        reviewPromises.push(
          anthropicConcurrencyLimit(async () => {
            await doReview(filename, fileContent, patches)
          })
        )
      } else {
        skippedFiles.push(filename)
      }
    }

    await Promise.all(reviewPromises)

    statusMsg += `
${
  reviewsFailed.length > 0
    ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join('\n* ')}

</details>
`
    : ''
}
${
  reviewsSkipped.length > 0
    ? `<details>
<summary>Files skipped from review due to trivial changes (${
        reviewsSkipped.length
      })</summary>

* ${reviewsSkipped.join('\n* ')}

</details>
`
    : ''
}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>提示</summary>

### 与 <img src="https://avatars.githubusercontent.com/in/347564?s=41&u=fad245b8b4c7254fe63dd4dcd4d662ace122757e&v=4" alt="Image description" width="20" height="20"> AIGNE CodeSmith (\`@codesmith\`) 聊天
- 回复此机器人留下的审查评论以提出后续问题。审查评论是对差异或文件的评论。
- 通过在回复中标记 \`@codesmith\` 邀请机器人加入审查评论链。

### 代码建议
- 机器人可能会提出代码建议，但在提交前请仔细审查它们，因为行号范围可能会不对齐。
- 你可以编辑机器人做出的评论，并在建议稍有偏差时手动调整。

### 暂停增量审查
- 在 PR 描述中的任何位置添加 \`@codesmith: ignore\` 以暂停机器人的进一步审查。

</details>
`
    // add existing_comment_ids_block with latest head sha
    summarizeComment += `\n${commenter.addReviewedCommitId(
      existingCommitIdsBlock,
      context.payload.pull_request.head.sha
    )}`

    // post the review
    await commenter.submitReview(
      context.payload.pull_request.number,
      commits[commits.length - 1].sha,
      statusMsg
    )
  }

  // post the final summary comment
  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, 'replace')
}

const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return []
  }

  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm

  const result: string[] = []
  let last = -1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(patch)) !== null) {
    if (last === -1) {
      last = match.index
    } else {
      result.push(patch.substring(last, match.index))
      last = match.index
    }
  }
  if (last !== -1) {
    result.push(patch.substring(last))
  }
  return result
}

const patchStartEndLine = (
  patch: string
): {
  oldHunk: { startLine: number; endLine: number }
  newHunk: { startLine: number; endLine: number }
} | null => {
  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@)/gm
  const match = pattern.exec(patch)
  if (match != null) {
    const oldBegin = parseInt(match[2])
    const oldDiff = parseInt(match[3])
    const newBegin = parseInt(match[4])
    const newDiff = parseInt(match[5])
    return {
      oldHunk: {
        startLine: oldBegin,
        endLine: oldBegin + oldDiff - 1
      },
      newHunk: {
        startLine: newBegin,
        endLine: newBegin + newDiff - 1
      }
    }
  } else {
    return null
  }
}

const parsePatch = (
  patch: string
): { oldHunk: string; newHunk: string } | null => {
  const hunkInfo = patchStartEndLine(patch)
  if (hunkInfo == null) {
    return null
  }

  const oldHunkLines: string[] = []
  const newHunkLines: string[] = []

  let newLine = hunkInfo.newHunk.startLine

  const lines = patch.split('\n').slice(1) // Skip the @@ line

  // Remove the last line if it's empty
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  // Skip annotations for the first 3 and last 3 lines
  const skipStart = 3
  const skipEnd = 3

  let currentLine = 0

  const removalOnly = !lines.some(line => line.startsWith('+'))

  for (const line of lines) {
    currentLine++
    if (line.startsWith('-')) {
      oldHunkLines.push(`${line.substring(1)}`)
    } else if (line.startsWith('+')) {
      newHunkLines.push(`${newLine}: ${line.substring(1)}`)
      newLine++
    } else {
      // context line
      oldHunkLines.push(`${line}`)
      if (
        removalOnly ||
        (currentLine > skipStart && currentLine <= lines.length - skipEnd)
      ) {
        newHunkLines.push(`${newLine}: ${line}`)
      } else {
        newHunkLines.push(`${line}`)
      }
      newLine++
    }
  }

  return {
    oldHunk: oldHunkLines.join('\n'),
    newHunk: newHunkLines.join('\n')
  }
}

interface Review {
  startLine: number
  endLine: number
  comment: string
}

function parseReview(
  response: string,
  patches: Array<[number, number, string]>,
  debug = false
): Review[] {
  const reviews: Review[] = []

  response = sanitizeResponse(response.trim())

  const lines = response.split('\n')
  const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/
  const commentSeparator = '---'

  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  let currentComment = ''
  function storeReview(): void {
    if (currentStartLine !== null && currentEndLine !== null) {
      const review: Review = {
        startLine: currentStartLine,
        endLine: currentEndLine,
        comment: currentComment
      }

      let withinPatch = false
      let bestPatchStartLine = -1
      let bestPatchEndLine = -1
      let maxIntersection = 0

      for (const [startLine, endLine] of patches) {
        const intersectionStart = Math.max(review.startLine, startLine)
        const intersectionEnd = Math.min(review.endLine, endLine)
        const intersectionLength = Math.max(
          0,
          intersectionEnd - intersectionStart + 1
        )

        if (intersectionLength > maxIntersection) {
          maxIntersection = intersectionLength
          bestPatchStartLine = startLine
          bestPatchEndLine = endLine
          withinPatch =
            intersectionLength === review.endLine - review.startLine + 1
        }

        if (withinPatch) break
      }

      if (!withinPatch) {
        if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
          review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = bestPatchStartLine
          review.endLine = bestPatchEndLine
        } else {
          review.comment = `> Note: This review was outside of the patch, but no patch was found that overlapped with it. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = patches[0][0]
          review.endLine = patches[0][1]
        }
      }

      reviews.push(review)

      info(
        `Stored comment for line range ${currentStartLine}-${currentEndLine}: ${currentComment.trim()}`
      )
    }
  }

  function sanitizeCodeBlock(comment: string, codeBlockLabel: string): string {
    const codeBlockStart = `\`\`\`${codeBlockLabel}`
    const codeBlockEnd = '```'
    const lineNumberRegex = /^ *(\d+): /gm

    let codeBlockStartIndex = comment.indexOf(codeBlockStart)

    while (codeBlockStartIndex !== -1) {
      const codeBlockEndIndex = comment.indexOf(
        codeBlockEnd,
        codeBlockStartIndex + codeBlockStart.length
      )

      if (codeBlockEndIndex === -1) break

      const codeBlock = comment.substring(
        codeBlockStartIndex + codeBlockStart.length,
        codeBlockEndIndex
      )
      const sanitizedBlock = codeBlock.replace(lineNumberRegex, '')

      comment =
        comment.slice(0, codeBlockStartIndex + codeBlockStart.length) +
        sanitizedBlock +
        comment.slice(codeBlockEndIndex)

      codeBlockStartIndex = comment.indexOf(
        codeBlockStart,
        codeBlockStartIndex +
          codeBlockStart.length +
          sanitizedBlock.length +
          codeBlockEnd.length
      )
    }

    return comment
  }

  function sanitizeResponse(comment: string): string {
    comment = sanitizeCodeBlock(comment, 'suggestion')
    comment = sanitizeCodeBlock(comment, 'diff')
    return comment
  }

  for (const line of lines) {
    const lineNumberRangeMatch = line.match(lineNumberRangeRegex)

    if (lineNumberRangeMatch != null) {
      storeReview()
      currentStartLine = parseInt(lineNumberRangeMatch[1], 10)
      currentEndLine = parseInt(lineNumberRangeMatch[2], 10)
      currentComment = ''
      if (debug) {
        info(`Found line number range: ${currentStartLine}-${currentEndLine}`)
      }
      continue
    }

    if (line.trim() === commentSeparator) {
      storeReview()
      currentStartLine = null
      currentEndLine = null
      currentComment = ''
      if (debug) {
        info('Found comment separator')
      }
      continue
    }

    if (currentStartLine !== null && currentEndLine !== null) {
      currentComment += `${line}\n`
    }
  }

  storeReview()

  return reviews
}

// 添加一个函数来评估代码块的重要性
function evaluatePatchImportance(patch: string): {
  importance: number
  reason: string
} {
  // 默认重要性为中等
  let importance = 0.5
  let reason = '默认中等重要性'

  // 如果代码块很小（少于3行），降低重要性
  const lines = patch.split('\n')
  if (lines.length < 3) {
    importance = 0.2
    reason = '代码块很小（少于3行）'
    return { importance, reason }
  }

  // 检查是否包含关键字，提高重要性
  const keywordsHigh = [
    'function',
    'class',
    'interface',
    'export',
    'import',
    'constructor',
    'async',
    'await',
    'try',
    'catch',
    'if',
    'else',
    'switch',
    'case',
    'for',
    'while',
    'do',
    'return',
    'throw',
    'new',
    'delete',
    'typeof',
    'instanceof'
  ]

  // 检查是否只是简单的修改，降低重要性
  const keywordsLow = [
    'console.log',
    'TODO',
    'FIXME',
    'NOTE',
    'eslint-disable',
    '// ',
    '/* ',
    ' */'
  ]

  // 计算关键字出现的次数
  let highKeywordCount = 0
  let lowKeywordCount = 0

  for (const line of lines) {
    for (const keyword of keywordsHigh) {
      if (line.includes(keyword)) {
        highKeywordCount++
      }
    }

    for (const keyword of keywordsLow) {
      if (line.includes(keyword)) {
        lowKeywordCount++
      }
    }
  }

  // 根据关键字出现的次数调整重要性
  if (highKeywordCount > 2) {
    importance = 0.8
    reason = `包含多个高重要性关键字 (${highKeywordCount})`
  } else if (lowKeywordCount > highKeywordCount && lines.length < 10) {
    importance = 0.3
    reason = `主要包含低重要性内容 (${lowKeywordCount})`
  }

  // 检查是否包含复杂逻辑
  const complexityIndicators = [
    '{',
    '}',
    'if',
    'else',
    'for',
    'while',
    'switch',
    'try',
    'catch'
  ]
  let complexityCount = 0

  for (const line of lines) {
    for (const indicator of complexityIndicators) {
      if (line.includes(indicator)) {
        complexityCount++
      }
    }
  }

  if (complexityCount > 3) {
    importance = Math.max(importance, 0.7)
    reason = `包含复杂逻辑 (复杂度: ${complexityCount})`
  }

  return { importance, reason }
}

// 合并相邻的小代码块
function mergePatchesIfNeeded(
  patches: Array<[number, number, string]>,
  maxPatchSize: number = 100
): Array<[number, number, string]> {
  if (patches.length <= 1) {
    return patches
  }

  const mergedPatches: Array<[number, number, string]> = []
  let currentPatch: [number, number, string] | null = null

  for (const patch of patches) {
    if (currentPatch === null) {
      currentPatch = [...patch]
      continue
    }

    const [currentStartLine, currentEndLine, currentPatchStr] =
      currentPatch as [number, number, string]
    const [nextStartLine, nextEndLine, nextPatchStr] = patch

    // 如果两个代码块相距不远且合并后不会太大，则合并它们
    if (
      nextStartLine - currentEndLine < 10 &&
      currentPatchStr.split('\n').length + nextPatchStr.split('\n').length <
        maxPatchSize
    ) {
      // 合并两个代码块
      currentPatch = [
        currentStartLine,
        nextEndLine,
        `${currentPatchStr}\n---merged_patch---\n${nextPatchStr}`
      ]
    } else {
      mergedPatches.push(currentPatch)
      currentPatch = [...patch]
    }
  }

  if (currentPatch !== null) {
    mergedPatches.push(currentPatch)
  }

  return mergedPatches
}
