<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed } from 'vue'
// webview
// https://www.electronjs.org/ja/docs/latest/api/webview-tag
import { WebviewTag, DidFrameFinishLoadEvent, LoadCommitEvent, IpcRendererEvent } from 'electron'
import { gameSetting } from '@renderer/store/gamesetting'
import {
  GameChannel,
  TaihaOverlayShipInfo,
  TaihaOverlayViewState,
  TaihaSingekiBlockState,
} from '@common/channel'
import { Const } from '@common/const'
import { gameState } from '@renderer/store/gamestate'
import { EnvRenderer } from '@renderer/common/env-renderer'
import { MainRendererState } from '@renderer/store/renderer_state'
import * as kcs_stuff from '@renderer/stuff/kcs_stuff'
import { ApiCallback } from '@common/kcs'
import { Api } from '@common/kcsapi'
import { svdata } from '@renderer/store/svdata'

const ipcRenderer = window.electron.ipcRenderer
const el = ref<HTMLElement | null>(null)
let stopSetZoomFactor: (() => void) | null = null
let stopSetTaihaOverlayShieldEnabled: (() => void) | null = null
let stopToggleTaihaOverlayTest: (() => void) | null = null
let stopToggleDmmHeader: (() => void) | null = null

/////////////////////////////////////////////////////////////////////////////////////
// デバッグログ
const DEBUG = 0;

const debug = (...args: any[]) => {
  if (DEBUG) console.debug("[game webview]", ...args);
};

/////////////////////////////////////////////////////////////////////////////////////
// 大破進撃防止関連
let cb_port = 0;
let cb_battle_result = 0;
let cb_combined_battle_result = 0;
let cb_goback_port = 0;
let cb_combined_goback_port = 0;
let cb_map_next = 0;
const taihaSingekiResult = ref<kcs_stuff.CheckTaihaSingekiResult | null>(null)
let blockShieldVisibleTimer: ReturnType<typeof setTimeout> | null = null
const isBlockShieldSwitch = ref<boolean>(true)
const taihaSingekiRechecked = ref<boolean>(false)
const isTaihaOverlayTestMode = ref<boolean>(false)

const testTaihaShipInfos: TaihaOverlayShipInfo[] = [
  {
    shipText: 'Lv.99島風',
    hasMegami: false,
    hasRepair: false,
    noDamageControl: true,
    subText: 'ダメコンなし',
  },
]

const clearBlockShieldVisibleTimer = () => {
  if (blockShieldVisibleTimer) {
    clearTimeout(blockShieldVisibleTimer)
    blockShieldVisibleTimer = null
  }
}

const taihaSingekiBlockStates = computed<TaihaSingekiBlockState[]>(() => {
  if (!taihaSingekiResult.value || !taihaSingekiResult.value.isTaihaSingeki) {
    return []
  }

  const states: TaihaSingekiBlockState[] = []
  const infos = taihaSingekiResult.value.infos

  for (const info of infos) {
    if (info.equips.includes(kcs_stuff.EquipType.flagship_megami)) {
      states.push(TaihaSingekiBlockState.megamiBlock)
    }
    if (info.equips.includes(kcs_stuff.EquipType.flagship_repair)) {
      states.push(TaihaSingekiBlockState.repairBlock)
    }
  }

  // 旗艦ではない場合、通常ブロック
  if (states.length === 0) {
    states.push(TaihaSingekiBlockState.normalBlock)
  }

  return states
})

const isTaihaSingekiBlock = computed<boolean>(() => {
  const result = taihaSingekiResult.value
  if (!result) {
    debug('isTaihaAdvanceBlockerVisible: no result')
    return false
  }
  debug('isTaihaAdvanceBlockerVisible: result', result)
  return result.isTaihaSingeki
})

const taihaShipInfos = computed<TaihaOverlayShipInfo[]>(() => {
  const result = taihaSingekiResult.value
  if (!result || !result.isTaihaSingeki) {
    debug('taihaShipInfos: no result')
    return []
  }

  let escapeTextAdded = false
  return result.infos.map((info) => {
    const subTexts: string[] = []
    const hasMegami = info.equips.includes(kcs_stuff.EquipType.flagship_megami) ||
      info.equips.includes(kcs_stuff.EquipType.megami)
    const hasRepair = info.equips.includes(kcs_stuff.EquipType.flagship_repair) ||
      info.equips.includes(kcs_stuff.EquipType.repair)
    const noDamageControl = info.equips.length === 0
    if (noDamageControl) {
      subTexts.push('ダメコンなし')
    }

    // 退避可能艦表示
    // 再チェック後では表示しない
    if (!taihaSingekiRechecked.value) {
      if (info.canEscape && !escapeTextAdded) {
        subTexts.push('退避可')
        escapeTextAdded = true
      }
    }

    const api = info.api_ship
    const mst = svdata.mstShip(api.api_ship_id)
    const shipText = `Lv.${api.api_lv}${mst?.api_name ?? ''}`
    const subText = subTexts.join(',')

    return {
      shipText,
      subText,
      hasMegami,
      hasRepair,
      noDamageControl,
    }
  })
})

const syncTaihaOverlayViewState = (): void => {
  if (isTaihaOverlayTestMode.value) {
    const testBlockStates = isBlockShieldSwitch.value
      ? [TaihaSingekiBlockState.normalBlock]
      : []
    const testState: TaihaOverlayViewState = {
      isTaihaSingekiBlock: true,
      isBlockShieldSwitch: isBlockShieldSwitch.value,
      blockStates: testBlockStates,
      shipInfos: testTaihaShipInfos,
    }
    window.api.setTaihaOverlayViewState(testState)
    return
  }

  const state: TaihaOverlayViewState = {
    isTaihaSingekiBlock: isTaihaSingekiBlock.value,
    isBlockShieldSwitch: isBlockShieldSwitch.value,
    blockStates: isBlockShieldSwitch.value ? [...taihaSingekiBlockStates.value] : [],
    shipInfos: [...taihaShipInfos.value],
  }
  window.api.setTaihaOverlayViewState(state)
}

const applyShieldState = (): void => {
  if (isTaihaOverlayTestMode.value) {
    if (isBlockShieldSwitch.value) {
      window.api.setTaihaSingekiBlockState([TaihaSingekiBlockState.normalBlock])
    } else {
      window.api.setTaihaSingekiBlockState([])
    }
    return
  }

  if (!isTaihaSingekiBlock.value || !isBlockShieldSwitch.value) {
    window.api.setTaihaSingekiBlockState([])
    return
  }

  window.api.setTaihaSingekiBlockState(taihaSingekiBlockStates.value)
}

const toggleTaihaOverlayTest = (): void => {
  isTaihaOverlayTestMode.value = !isTaihaOverlayTestMode.value
  isBlockShieldSwitch.value = true
  applyShieldState()
  syncTaihaOverlayViewState()
}

/////////////////////////////////////////////////////////////////////////////////////
// DMM Gamesヘッダ非表示関連
const isDmmHeaderHidden = ref<boolean>(false)

const toggleDmmHeader = (): void => {
  isDmmHeaderHidden.value = !isDmmHeaderHidden.value
  applyDmmHeaderVisibility()
}

function applyDmmHeaderVisibility(): void {
  const code = `(function(){
    const hidden = ${isDmmHeaderHidden.value};
    if (!document.head) {
      return false;
    }

    let style = document.getElementById('kb-dmm-header-hide');
    if (!style) {
      style = document.createElement('style');
      style.id = 'kb-dmm-header-hide';
      document.head.appendChild(style);
    }

    const cssText = [
      '#root > div > header,',
      '#root > div > nav,',
      '#root > div > [role="banner"],',
      '#root header,',
      'header[id*="header"],',
      'header[class*="header"],',
      '#root > div > div > header,',
      '#root > div > div > nav {',
      '  visibility: hidden !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}'
    ].join('\\n');

    style.textContent = hidden ? cssText : '';
    return true;
  })()`
  getWebviewUnsafe().executeJavaScript(code).then((any) => {
    debug('dmm header visibility applied', isDmmHeaderHidden.value, any)
  }).catch((error: unknown) => {
    console.error('failed to apply dmm header visibility', error)
  })
}

/////////////////////////////////////////////////////////////////////////////////////
// game webview関連

// mute状態はDOM-READY後ではないと設定できないことに注意
let mutedStateApplied = false

const StageType = {
  None: 0,
  GameStartLoading: 1,
} as const
export type StageType = (typeof StageType)[keyof typeof StageType]

const stage = ref<StageType>(StageType.None)

watch(
  () => gameSetting.zoom_factor,
  (newVal, oldVal) => {
    debug('zoom factor changed', gameSetting.zoom_factor)
    getWebviewUnsafe().setZoomFactor(gameSetting.zoom_factor)

    debug('zoom factor changed', newVal, oldVal)
    if (newVal !== oldVal) {
      const webview = getWebview()
      if (webview) {
        webview.setZoomFactor(newVal)
      }
    }
  }
)

function gameUrl(): string {
  // if use test data
  if (EnvRenderer.isTestMode) {
    return 'about:blank'
  }
  return Const.GamePageUrl
}

function getWebview(): WebviewTag | undefined {
  if (el.value === null) {
    return undefined
  }

  const ret = el.value!.querySelector('#kb')
  if (ret) {
    return ret as WebviewTag
  }
  return undefined
}

function getWebviewUnsafe(): WebviewTag {
  return getWebview() as WebviewTag
}

onMounted(() => {
  const webview = getWebview()
  debug('game mounted >> webview', webview, 'appLaunchId:', EnvRenderer.appLaunchId)
  if (webview) {
    webview.addEventListener('dom-ready', domReady)
    webview.addEventListener('load-commit', loadCommit)
    webview.addEventListener('did-start-loading', didStartLoading)
    webview.addEventListener('did-finish-loading', didFinishLoading)
    webview.addEventListener('did-frame-finish-load', didFrameFinishLoad)
    webview.addEventListener('media-started-playing', mediaStartedPlaying)
    webview.addEventListener('media-paused', mediaPaused)
  }

  stopSetZoomFactor = ipcRenderer.on(GameChannel.set_zoom_factor, setZoomFactor)
  stopSetTaihaOverlayShieldEnabled = ipcRenderer.on(
    GameChannel.set_taiha_overlay_shield_enabled,
    (_event: IpcRendererEvent, enabled: boolean) => {
      if (isBlockShieldSwitch.value === enabled) {
        return
      }
      isBlockShieldSwitch.value = enabled
      onBlockShieldSwitchChanged(enabled)
    }
  )
  stopToggleTaihaOverlayTest = ipcRenderer.on(
    GameChannel.toggle_taiha_overlay_test,
    () => {
      toggleTaihaOverlayTest()
    }
  )
  stopToggleDmmHeader = ipcRenderer.on(
    GameChannel.toggle_dmm_header,
    () => {
      toggleDmmHeader()
    }
  )

  // 大破進撃防止関連
  cb_port = ApiCallback.set([Api.PORT_PORT, () => onPort()])
  cb_battle_result = ApiCallback.set(
    [Api.REQ_SORTIE_BATTLERESULT, () => onBattleResult()]
  )
  cb_combined_battle_result = ApiCallback.set(
    [Api.REQ_COMBINED_BATTLE_BATTLERESULT, () => onBattleResult()]
  )
  cb_goback_port = ApiCallback.set(
    [Api.REQ_SORTIE_GOBACK_PORT, () => onGobackPort()]
  )
  cb_combined_goback_port = ApiCallback.set(
    [Api.REQ_COMBINED_BATTLE_GOBACK_PORT, () => onGobackPort()]
  )
  cb_map_next = ApiCallback.set(
    [Api.REQ_MAP_NEXT, () => onMapNext()]
  )

  syncTaihaOverlayViewState()

  debug('game mounted <<')
})

onUnmounted(() => {
  const webview = getWebview()
  debug('game destroyed webview:', webview)
  debug('game unmounted >>')
  if (webview) {
    webview.removeEventListener('dom-ready', domReady)
    webview.removeEventListener('load-commit', loadCommit)
    webview.removeEventListener('did-start-loading', didStartLoading)
    webview.removeEventListener('did-finish-loading', didFinishLoading)
    webview.removeEventListener('did-frame-finish-load', didFrameFinishLoad)
    webview.removeEventListener('media-started-playing', mediaStartedPlaying)
    webview.removeEventListener('media-paused', mediaPaused)
  }

  stopSetZoomFactor?.()
  stopSetZoomFactor = null

  stopSetTaihaOverlayShieldEnabled?.()
  stopSetTaihaOverlayShieldEnabled = null

  stopToggleTaihaOverlayTest?.()
  stopToggleTaihaOverlayTest = null

  stopToggleDmmHeader?.()
  stopToggleDmmHeader = null

  if (cb_port) {
    ApiCallback.unset(cb_port)
    cb_port = 0
  }
  if (cb_battle_result) {
    ApiCallback.unset(cb_battle_result)
    cb_battle_result = 0
  }
  if (cb_combined_battle_result) {
    ApiCallback.unset(cb_combined_battle_result)
    cb_combined_battle_result = 0
  }
  if (cb_goback_port) {
    ApiCallback.unset(cb_goback_port)
    cb_goback_port = 0
  }
  if (cb_combined_goback_port) {
    ApiCallback.unset(cb_combined_goback_port)
    cb_combined_goback_port = 0
  }
  if (cb_map_next) {
    ApiCallback.unset(cb_map_next)
    cb_map_next = 0
  }
  clearBlockShieldVisibleTimer()

  debug('game unmounted <<')
})

function setZoomFactor(_event: IpcRendererEvent, factor: number): void {
  debug(GameChannel.set_zoom_factor, factor)
  getWebviewUnsafe().setZoomFactor(factor)
}

function domReady(_event: Event): void {
  debug('domReady')

  // apply muted state if needed
  if (!mutedStateApplied) {
    mutedStateApplied = true
    debug('apply muted state in domReady, muted:', gameState.muted)

    if (gameState.muted) {
      // mute状態では無ければmuteに設定
      const webview = getWebview()
      if (webview) {
        debug('initially muted. check webview muted state:', webview.isAudioMuted())
        if (!webview.isAudioMuted()) {
          setMute(true, false)
        }
      }
    }
  }

  getWebviewUnsafe().setZoomFactor(gameSetting.zoom_factor)
}

const isOrigin = (url: string, checkOrigin: string): boolean => {
  try {
    const u = new URL(url)
    return u.origin === checkOrigin
  } catch (e) {
    console.error('invalid url', url, e)
    return false
  }
}

function loadCommit(event: LoadCommitEvent): void {
  if (!event.isMainFrame) {
    debug('loadCommit', 'mainframe:', event.isMainFrame, 'url:', event.url, event);
  }
  if (
    isStage(StageType.GameStartLoading) &&
    !event.isMainFrame &&
    isOrigin(event.url, 'https://osapi.dmm.com')
  ) {
    debug('loadCommit: game start loading detected', event.url)
    insertModCss()
    gameFrameScrollOff()
    if (isDmmHeaderHidden.value) {
      applyDmmHeaderVisibility()
    }
  }
}

function didStartLoading(_event: Event): void {
  debug('did-start-loading')
}

function didFinishLoading(_event: Event): void {
  debug('did-finish-loading')
}

function didFrameFinishLoad(event: DidFrameFinishLoadEvent): void {

  if (event.isMainFrame) {
    const url = getWebviewUnsafe().getURL()
    debug('didFrameFinishLoad', event, url);
    if (url !== Const.GamePageUrl) {
      return
    }

    debug('didFrameFinishLoad game top loaded, try click sortie button')
    stage.value = StageType.GameStartLoading

    const code = `(function(){
      let a = document.querySelector('.fn-rollover.btn a');
      if (a) {
        a.click();
        return true;
      }
      return false;
    })()`
    getWebviewUnsafe().executeJavaScript(code).then((any) => {
      debug('clicked', any)
    })
  }
}

function insertModCss() {
  const css = `
body {
overflow: hidden;
}
#root > div > main,
main {
padding-top: 0 !important;
margin-top: 0 !important;
}
#root > div.gamesResetStyle > header > nav > div:nth-of-type(1) {
justify-content: flex-start !important;
}
#game_frame {
height: 736px !important;
width: 1200px !important;
}
`
  getWebviewUnsafe().insertCSS(css).then((key) => {
    debug('css inserted', key)
  })
}

function gameFrameScrollOff() {
  const code = `(function(){
    let a = document.querySelector('#game_frame');
    if (a) {
      a.scrolling = 'no';
      return true;
    }
      return false;
  })()`
  getWebviewUnsafe()
    .executeJavaScript(code)
    .then((any) => {
      debug('scrolling set:', any)
    })
}

function mediaStartedPlaying(_event: Event): void {
  debug('mediaStartedPlaying')
}

function mediaPaused(_event: Event): void {
  debug('mediaPaused')
}

function setMute(mute: boolean, notifyCheck: boolean): void {
  const webview = getWebview()
  if (webview) {
    const oldMuted = gameState.muted
    debug('now webview muted:', webview.isAudioMuted(), 'muted state:', oldMuted, 'notifyCheck:', notifyCheck)
    webview.setAudioMuted(mute)
    gameState.muted = webview.isAudioMuted()
    MainRendererState.updateRendererState(gameState.muted)
    debug('set muted:', gameState.muted)
    if (notifyCheck && oldMuted !== gameState.muted) {
      debug('notify mute state changed:', gameState.muted)
      window.api.notifyMuteState(gameState.muted)
    }
  }
}

function isStage(check: StageType): boolean {
  return stage.value === check
}

// exports
defineExpose({
  getWebview,
  setMute
})

/////////////////////////////////////////////////////////////////////////////////////
// 大破進撃関連
function onPort(): void {
  if (isTaihaOverlayTestMode.value) {
    return
  }
  debug('onPort')
  taihaSingekiResult.value = null
  window.api.setTaihaSingekiBlockState([])
  syncTaihaOverlayViewState()
  clearBlockShieldVisibleTimer()
}

/**
 * 大破進撃チェック
 * 大破艦がいれば、大破進撃防止UIを表示する
 */
const checkSingekiBlock = () => {
  if (isTaihaOverlayTestMode.value) {
    return
  }

  const result = kcs_stuff.checkTaihaSingeki(kcs_stuff.TaihaCheckPhase.afterBattle)
  debug('onBattleResult', result)

  if (! result.isTaihaSingeki) {
    debug('onBattleResult: no taiha singeki')
    taihaSingekiResult.value = null
    window.api.setTaihaSingekiBlockState([])
    syncTaihaOverlayViewState()
    return
  }

  // 大破判定となった場合、戦闘結果画面が表示される約9秒後に表示する
  const delayMs = 9000
  blockShieldVisibleTimer = setTimeout(() => {
    taihaSingekiResult.value = result
    window.api.setTaihaSingekiBlockState(taihaSingekiBlockStates.value)
    syncTaihaOverlayViewState()
    blockShieldVisibleTimer = null
  }, delayMs)
}

/**
 * 戦闘結果終了
 * 大破進撃防止判定を行う
 */
function onBattleResult(): void {
  if (isTaihaOverlayTestMode.value) {
    return
  }

  clearBlockShieldVisibleTimer()
  isBlockShieldSwitch.value = true
  taihaSingekiRechecked.value = false
  gameState.ctrl_pressed = false
  syncTaihaOverlayViewState()

  debug('onBattleResult: check taiha singeki block.',
    'enable:', gameSetting.taihaSingekiBlockEnable,
    'skip safe cell:', gameSetting.taihaSingekiBlockSkipSafeCell)

  // オプション設定で無効
  if (! gameSetting.taihaSingekiBlockEnable) {
    debug('onBattleResult: taiha singeki block disabled by option')
    syncTaihaOverlayViewState()
    return
  }

  // オプション設定で安全マススキップ有効で、かつ安全マスなら判定しない
  if (gameSetting.taihaSingekiBlockSkipSafeCell) {
    if (kcs_stuff.currentIsSafeCell()) {
      debug('onBattleResult: safe cell, skip taiha singeki block check')
      syncTaihaOverlayViewState()
      return
    }
  }

  // todo
  // 大破進撃防止の判定は、艦隊HP更新後に行う必要があることの改善
  // 艦隊HP更新はcallback呼び出し後に行われることからsettimeoutで遅延判定する
  setTimeout(() => {
    checkSingekiBlock()
  }, 0)
}

/**
 * 退避が行われた場合は、再度大破進撃判定を行う
 */
function onGobackPort(): void {
  if (isTaihaOverlayTestMode.value) {
    return
  }

  // 大破進撃判定済みで再度判定を行う
  // オプション設定で無効であっても一度動作した大破進撃チェックは継続して動作させる
  const currentResult = taihaSingekiResult.value
  if (! currentResult || !currentResult.isTaihaSingeki) {
    debug('onGobackPort: no taiha singeki result, skip recheck')
    return
  }

  // 退避が行われた場合、再度大破進撃判定
  const result = kcs_stuff.checkTaihaSingeki(kcs_stuff.TaihaCheckPhase.afterBattle)
  if (result.isTaihaSingeki) {
    // 情報更新
    debug('onGobackPort: taiha singeki')
    taihaSingekiRechecked.value = true
    taihaSingekiResult.value = result
    window.api.setTaihaSingekiBlockState(taihaSingekiBlockStates.value)
    syncTaihaOverlayViewState()
  } else {
    debug('onGobackPort: no taiha singeki')

    // UI非表示
    taihaSingekiResult.value = null
    window.api.setTaihaSingekiBlockState([])
    syncTaihaOverlayViewState()
  }
}

function onMapNext(): void {
  if (isTaihaOverlayTestMode.value) {
    return
  }
  debug('onMapNext')
  taihaSingekiResult.value = null
  window.api.setTaihaSingekiBlockState([])
  syncTaihaOverlayViewState()
}

const onBlockShieldSwitchChanged = (enabled: boolean): void => {
  debug('block shield changed', enabled)
  isBlockShieldSwitch.value = enabled
  applyShieldState()
  syncTaihaOverlayViewState()
}

</script>
<template>
  <div class="game-container" ref="el">
    <webview
      id="kb"
      class="kb"
      :src="gameUrl()"
      allowpopups
      enableremotemodule="false"
      nodeintegration="false"
      nodeIntegrationInSubFrames="true"
      webPreferences="contextIsolation=no, sandbox=no"
    ></webview>

  </div>
</template>
