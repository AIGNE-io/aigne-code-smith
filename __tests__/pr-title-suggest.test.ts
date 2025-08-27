import { suggestPrTitle } from '../src/pr-title-suggest'

// Mock the GitHub context and other dependencies
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

jest.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    payload: {
      pull_request: {
        title: 'Test PR Title',
        body: 'Test PR Description',
        number: 1
      }
    }
  }
}))

jest.mock('../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => ({
    comment: jest.fn()
  })),
  PR_TITLE_TAG: '<!-- PR_TITLE_TAG -->'
}))

jest.mock('../src/inputs', () => ({
  Inputs: jest.fn().mockImplementation(() => ({
    title: '',
    description: '',
    diff: ''
  }))
}))

describe('suggestPrTitle', () => {
  const mockBot = {
    chat: jest.fn()
  }

  const mockOptions = {
    suggestPrTitle: true
  }

  const mockPrompts = {
    renderSuggestPrTitle: jest.fn().mockReturnValue('Generate PR titles for: $diff')
  }

  const mockTargetBranchDiff = {
    data: {
      files: [
        {
          filename: 'src/test.js',
          patch: '+ console.log("hello world")'
        },
        {
          filename: 'package-lock.json',
          patch: '+ some dependency change'
        }
      ]
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should skip if feature is disabled', async () => {
    const options = { ...mockOptions, suggestPrTitle: false }
    
    await suggestPrTitle(mockBot as any, options as any, mockPrompts as any, mockTargetBranchDiff)
    
    expect(mockBot.chat).not.toHaveBeenCalled()
  })

  it('should filter out dependency files when other files exist', async () => {
    mockBot.chat.mockResolvedValue(['feat: add hello world logging'])
    
    await suggestPrTitle(mockBot as any, mockOptions as any, mockPrompts as any, mockTargetBranchDiff)
    
    expect(mockPrompts.renderSuggestPrTitle).toHaveBeenCalled()
    expect(mockBot.chat).toHaveBeenCalled()
    
    const inputs = mockPrompts.renderSuggestPrTitle.mock.calls[0][0]
    expect(inputs.diff).toContain('src/test.js')
    expect(inputs.diff).not.toContain('package-lock.json')
  })

  it('should include dependency files if they are the only changes', async () => {
    const diffWithOnlyDependencies = {
      data: {
        files: [
          {
            filename: 'package-lock.json',
            patch: '+ some dependency change'
          }
        ]
      }
    }
    
    mockBot.chat.mockResolvedValue(['chore: update dependencies'])
    
    await suggestPrTitle(mockBot as any, mockOptions as any, mockPrompts as any, diffWithOnlyDependencies)
    
    const inputs = mockPrompts.renderSuggestPrTitle.mock.calls[0][0]
    expect(inputs.diff).toContain('package-lock.json')
  })

  it('should handle empty response from bot gracefully', async () => {
    mockBot.chat.mockResolvedValue([''])
    
    await suggestPrTitle(mockBot as any, mockOptions as any, mockPrompts as any, mockTargetBranchDiff)
    
    expect(mockBot.chat).toHaveBeenCalled()
    // Should not throw an error
  })
})