import { describe, expect, it } from 'vitest'
import { startingSettings } from './settings'

const defaults = { specId: 'us-2x2', printId: null, layoutMode: 'auto', cutGuides: true }

describe('startingSettings', () => {
  it('starts with the defaults on a first visit', () => {
    expect(startingSettings(null, '')).toEqual(defaults)
  })

  it('restores what was remembered', () => {
    const stored = JSON.stringify({ specId: 'cn-visa', printId: '5x7', layoutMode: 'safe', cutGuides: false })
    expect(startingSettings(stored, '')).toEqual({ specId: 'cn-visa', printId: '5x7', layoutMode: 'safe', cutGuides: false })
  })

  it('lets a ?type= link choose the photo type over what was remembered', () => {
    const stored = JSON.stringify({ specId: 'cn-visa', printId: '5x7' })
    expect(startingSettings(stored, '?type=in-online')).toMatchObject({ specId: 'in-online', printId: '5x7' })
  })

  it('ignores unknown photo types, print sizes and values', () => {
    expect(
      startingSettings(JSON.stringify({ specId: 'gone', printId: '9x9', layoutMode: 'tiny', cutGuides: 'yes' }), '?type=nope'),
    ).toEqual(defaults)
    expect(startingSettings(JSON.stringify({ specId: 'gone' }), '?type=ca-visa').specId).toBe('ca-visa')
  })

  it('starts afresh from anything that isn’t a saved settings object', () => {
    for (const stored of ['not json', 'null', '42', '"text"', '[]']) expect(startingSettings(stored, '')).toEqual(defaults)
  })
})
