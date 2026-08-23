<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Const } from '@common/const'
import { GameChannel, TaihaOverlayViewState, TaihaSingekiBlockState } from '@common/channel'
import { IpcRendererEvent } from 'electron'
import BlockShield from '@renderer/components/BlockShield.vue'
import WarningIcon from '@assets/img/warning.svg'

const ipcRenderer = window.electron.ipcRenderer

type BlockShieldInstance = InstanceType<typeof BlockShield>

const normalBlockShieldRef = ref<BlockShieldInstance | null>(null)
const repairBlockShieldRef = ref<BlockShieldInstance | null>(null)
const megamiBlockShieldRef = ref<BlockShieldInstance | null>(null)

const overlayViewState = ref<TaihaOverlayViewState>({
  isTaihaSingekiBlock: false,
  isBlockShieldSwitch: true,
  blockStates: [],
  shipInfos: [],
})

const ctrlPressed = ref(false)
const hoveredStates = ref<TaihaSingekiBlockState[]>([])
const isWarningVisible = ref(false)

let stopSetTaihaOverlayStates: (() => void) | null = null
let stopSetCtrlState: (() => void) | null = null
let stopGuardHitEffect: (() => void) | null = null
let stopSetTaihaOverlayHoverState: (() => void) | null = null

const normalBlockRectRate = Const.TaihaSingeki.normalBlockRect
const repairBlockRectRate = Const.TaihaSingeki.repairBlockRect
const megamiBlockRectRate = Const.TaihaSingeki.megamiBlockRect

const isTaihaSingekiBlock = computed<boolean>(() => overlayViewState.value.isTaihaSingekiBlock)
const isBlockShieldSwitch = computed<boolean>(() => overlayViewState.value.isBlockShieldSwitch)
const taihaShipInfos = computed(() => overlayViewState.value.shipInfos)

const isShieldVisible = (state: TaihaSingekiBlockState): boolean => {
  if (!isTaihaSingekiBlock.value) {
    return false
  }
  if (ctrlPressed.value) {
    return false
  }
  return overlayViewState.value.blockStates.includes(state)
}

const isShieldHovered = (state: TaihaSingekiBlockState): boolean => {
  return hoveredStates.value.includes(state)
}

const isNormalBlockVisible = computed<boolean>(() => isShieldVisible(TaihaSingekiBlockState.normalBlock))
const isRepairBlockVisible = computed<boolean>(() => isShieldVisible(TaihaSingekiBlockState.repairBlock))
const isMegamiBlockVisible = computed<boolean>(() => isShieldVisible(TaihaSingekiBlockState.megamiBlock))

function guardHitEffect(_event: IpcRendererEvent, state: TaihaSingekiBlockState): void {
  if (state === TaihaSingekiBlockState.normalBlock) {
    normalBlockShieldRef.value?.doGuardHitEffect()
  } else if (state === TaihaSingekiBlockState.repairBlock) {
    repairBlockShieldRef.value?.doGuardHitEffect()
  } else if (state === TaihaSingekiBlockState.megamiBlock) {
    megamiBlockShieldRef.value?.doGuardHitEffect()
  }
}

onMounted(() => {
  stopSetTaihaOverlayStates = ipcRenderer.on(
    GameChannel.set_taiha_overlay_view_state,
    (_event: IpcRendererEvent, state: TaihaOverlayViewState) => {
      overlayViewState.value = {
        isTaihaSingekiBlock: !!state?.isTaihaSingekiBlock,
        isBlockShieldSwitch: !!state?.isBlockShieldSwitch,
        blockStates: Array.isArray(state?.blockStates) ? [...state.blockStates] : [],
        shipInfos: Array.isArray(state?.shipInfos) ? [...state.shipInfos] : [],
      }
      isWarningVisible.value = !!state?.isTaihaSingekiBlock
    }
  )

  stopSetCtrlState = ipcRenderer.on(
    GameChannel.set_ctrl_state,
    (_event: IpcRendererEvent, pressed: boolean) => {
      ctrlPressed.value = !!pressed
    }
  )

  stopGuardHitEffect = ipcRenderer.on(GameChannel.guard_hit_effect, guardHitEffect)
  stopSetTaihaOverlayHoverState = ipcRenderer.on(
    GameChannel.set_taiha_overlay_hover_state,
    (_event: IpcRendererEvent, states: TaihaSingekiBlockState[]) => {
      hoveredStates.value = Array.isArray(states) ? [...states] : []
    }
  )
})

onUnmounted(() => {
  stopSetTaihaOverlayStates?.()
  stopSetTaihaOverlayStates = null

  stopSetCtrlState?.()
  stopSetCtrlState = null

  stopGuardHitEffect?.()
  stopGuardHitEffect = null

  stopSetTaihaOverlayHoverState?.()
  stopSetTaihaOverlayHoverState = null
})

const onBlockShieldSwitchChanged = (enabled: boolean): void => {
  window.api.setTaihaOverlayShieldEnabled(enabled)
}

const onShieldSwitchMouseEnter = (): void => {
  window.api.setTaihaOverlayMouseEvents(true)
}

const onShieldSwitchMouseLeave = (): void => {
  window.api.setTaihaOverlayMouseEvents(false)
}
</script>

<template>
  <div class="taiha-overlay-window">
    <div class="taiha-overlay">
      <transition name="slide-effect" appear>
        <div v-if="isWarningVisible" class="taiha-warning-banner">
        <div class="banner-title"><WarningIcon />大破艦を検知しました</div>
        <div class="banner-text">
          轟沈防止で進撃操作を制限しています。シールドOFFで操作可能です。
        </div>
        <div class="banner-text">
          大破艦：
          <template v-for="(info, index) in taihaShipInfos" :key="`${index}-${info.shipText}-${info.subText}`">
            <span class="taiha-info">
              {{ info.shipText }}&#12308;<img
                v-if="info.hasRepair"
                class="dameconimg"
                src="../assets/img/app/repair.png"
              /><img
                v-if="info.hasMegami"
                class="dameconimg"
                src="../assets/img/app/megami.png"
              /><WarningIcon v-if="info.noDamageControl" />{{ info.subText }}&#12309;
            </span><template v-if="index < taihaShipInfos.length - 1">, </template>
          </template>
        </div>
        </div>
      </transition>

      <div v-if="isTaihaSingekiBlock">
        <transition name="slide-effect" appear>
        <b-switch
          v-if="isTaihaSingekiBlock"
          :model-value="isBlockShieldSwitch"
          type="is-danger"
          class="block-shield-toggle"
          :left-label="true"
          @mouseenter="onShieldSwitchMouseEnter"
          @mouseleave="onShieldSwitchMouseLeave"
          @update:modelValue="onBlockShieldSwitchChanged"
        ><span class="switch-text">{{ isBlockShieldSwitch ? 'シールドON' : 'シールドOFF' }}</span></b-switch>
        </transition>

        <BlockShield
        v-if="isNormalBlockVisible"
        ref="normalBlockShieldRef"
        :is-hovered="isShieldHovered(TaihaSingekiBlockState.normalBlock)"
          :rect-rate="normalBlockRectRate" />
        <BlockShield
        v-if="isRepairBlockVisible"
        ref="repairBlockShieldRef"
        :is-hovered="isShieldHovered(TaihaSingekiBlockState.repairBlock)"
          :rect-rate="repairBlockRectRate" />
        <BlockShield
        v-if="isMegamiBlockVisible"
        ref="megamiBlockShieldRef"
        :is-hovered="isShieldHovered(TaihaSingekiBlockState.megamiBlock)"
          :rect-rate="megamiBlockRectRate" />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
html.taiha-overlay-mode,
html.taiha-overlay-mode body,
html.taiha-overlay-mode #app {
  width: 100% !important;
  height: 100% !important;
  background: transparent !important;
  background-color: transparent !important;
  overflow: hidden !important;
}

.taiha-overlay-window {
  position: relative;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent !important;
  background-color: transparent !important;

  .taiha-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
  }

  $waring-text-color: #f9dbcf;

  .taiha-warning-banner {
    position: absolute;
    left: 50%;
    top: 7%;
    transform: translateX(-50%);
    z-index: 20;

    width: 46%;
    min-height: 52px;
    padding: 7px 16px 8px;

    box-sizing: border-box;
    border: 2px solid #ff6b4a;
    border-radius: 6px;

    background: linear-gradient(180deg, rgba(166, 24, 16, 0.96), rgba(103, 8, 6, 0.96));

    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 2px 8px rgba(0, 0, 0, 0.45);

    color: $waring-text-color;
    text-align: center;
    text-shadow: 1px 1px 2px #000;
    user-select: none;
    pointer-events: none;

    svg {
      display: block;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      fill: $waring-text-color;
      filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.7));
    }
  }

  .banner-title {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;

    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 4px;
  }

  .banner-text {
    color: #ffe6a3;
    font-size: 15px;
    line-height: 1.3;

    svg {
      transform: translateY(-1px);
      display: inline-block;
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
    }
  }

  .taiha-info {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  .dameconimg {
    width: 18px;
    height: 18px;
    object-fit: contain;
    flex: 0 0 auto;
    margin-right: 2px;

    &:last-of-type {
      margin-right: 2px;
    }
  }

  .block-shield-toggle {
    position: absolute;
    left: calc(50% + 23% + 12px);
    top: 10.5%;
    z-index: 21;

    width: 137px;

    .switch-text {
      display: inline-block;
      min-width: 78px;
      text-align: left;
    }

    --bulma-control-padding-horizontal: 0px;

    height: 32px;
    padding: 0 10px;

    box-sizing: border-box;
    border: 1px solid #ff6b4a;
    border-radius: 4px;

    background: rgba(110, 18, 12, 0.98);

    &:hover {
      background: rgba(126, 26, 18, 0.98);
    }

    color: #ffe6a3;
    font-size: 13px;
    font-weight: 700;
    text-shadow: 1px 1px 2px #000;
    cursor: pointer;
    pointer-events: auto;

    &.slide-effect-enter-from,
    &.slide-effect-leave-to {
      opacity: 0;
      transform: translateY(10px);
    }

    &.slide-effect-enter-to,
    &.slide-effect-leave-from {
      opacity: 1;
      transform: translateY(0px);
    }

    &.slide-effect-enter-active,
    &.slide-effect-leave-active {
      transition-property: transform, opacity;
      transition-duration: 0.5s;
      transition-delay: 0s;
      transition-timing-function: ease;
      will-change: transform, opacity;
    }
  }

  .button-cover-shield {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;

    &.is-guard-hit {
      .shield-fill {
        animation: cyber-shield-fill-hit 0.55s ease-out;
      }
      .shield-border-outer {
        animation: cyber-shield-border-hit 0.55s ease-out;
      }
      .shield-border-inner {
        animation: cyber-shield-inner-hit 0.55s ease-out;
      }
    }
  }

  .shield-fill {
    fill: rgba(80, 220, 255, 0.04);
  }

  .shield-border-outer {
    fill: none;
    stroke: rgba(170, 245, 255, 0.1);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }

  .shield-border-inner {
    fill: none;
    stroke: rgba(90, 220, 255, 0.05);
    stroke-width: 1;
    stroke-linejoin: round;
  }

  @keyframes cyber-shield-fill-hit {
    0% {
      fill: rgba(80, 220, 255, 0.04);
    }

    20% {
      fill: rgba(80, 220, 255, 0.48);
    }

    100% {
      fill: rgba(80, 220, 255, 0.04);
    }
  }

  @keyframes cyber-shield-border-hit {
    0% {
      stroke: rgba(170, 245, 255, 0.52);
      stroke-width: 2.5;
      filter: none;
    }

    20% {
      stroke: rgba(220, 255, 255, 0.98);
      stroke-width: 3;
      filter: var(--shield-glow-url);
    }

    100% {
      stroke: rgba(170, 245, 255, 0.52);
      stroke-width: 2.5;
      filter: none;
    }
  }

  @keyframes cyber-shield-inner-hit {
    0% {
      stroke: rgba(90, 220, 255, 0.25);
    }

    20% {
      stroke: rgba(120, 255, 255, 0.85);
    }

    100% {
      stroke: rgba(90, 220, 255, 0.25);
    }
  }

  .button-cover {
    position: absolute;
    user-select: none;

    opacity: 0;
    transition-property: transform, opacity;
    transition-duration: 0.15s;
    transition-delay: 0s;
    transition-timing-function: ease;

    --left: 23%;
    --top: 41%;
    --width: 25%;
    --height: 25%;

    left: var(--left);
    top: var(--top);
    width: var(--width);
    height: var(--height);

    pointer-events: none;

    &:hover, &.is-hovered, &.is-guard-hit {
      opacity: 1;
      transform: scale(1.25);
    }

    svg {
      width: 100%;
      height: 100%;
    }
  }
}
</style>
