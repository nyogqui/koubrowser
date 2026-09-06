import { describe, expect, it } from 'vitest'
import {
  ApiQuestCategory,
  ApiQuestState,
  ApiQuestType,
  EmptyApiQuestList,
  SvData,
  createSvDataRaw
} from '@common/kcs'
import { Api } from '@common/kcsapi'
import type { ApiQuest } from '@common/kcs'

function createQuest(apiNo: number): ApiQuest {
  return {
    api_no: apiNo,
    api_category: ApiQuestCategory.ensei,
    api_type: ApiQuestType.daily,
    api_label_type: 0,
    api_state: ApiQuestState.completed,
    api_title: '',
    api_detail: '',
    api_voice_id: 0,
    api_get_material: [0, 0, 0, 0],
    api_bonus_flag: 0,
    api_progress_flag: 0,
    api_invalid_flag: 0
  }
}

describe('SvData quest state tests', () => {
  it('removes only the reported quest from the local quest list', () => {
    const raw = createSvDataRaw()
    const svdata = new SvData(raw)
    const questlist = EmptyApiQuestList()
    questlist.api_list.push(createQuest(101), createQuest(102))
    Object.assign(raw.apiData, { api_questlist: questlist })

    svdata.setReq(Api.REQ_QUEST_CLEARITEMGET, 'api_verno=1&api_quest_id=101')
    svdata.update(Api.REQ_QUEST_CLEARITEMGET, '{"api_result":1,"api_data":{}}')

    expect(svdata.questlist?.api_list.map((quest) => quest.api_no)).toEqual([102])
  })

  it('accepts a reported quest when the local quest list is unavailable', () => {
    const svdata = new SvData(createSvDataRaw())
    svdata.setReq(Api.REQ_QUEST_CLEARITEMGET, 'api_verno=1&api_quest_id=101')

    expect(() => {
      svdata.update(Api.REQ_QUEST_CLEARITEMGET, '{"api_result":1,"api_data":{}}')
    }).not.toThrow()
  })
})