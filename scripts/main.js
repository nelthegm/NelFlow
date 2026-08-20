import { renderNelflowChat } from "./chat-ui.js";
import { MODULE_ID } from "./constants.js";
import { logger } from "./logger.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { migrateSettings, registerSettings } from "./settings.js";
import { SaveResolverService } from "./save-resolver-service.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TurnStackService } from "./turn-stack-service.js";
import { ToolbeltBasicSaveService } from "./toolbelt-basic-save-service.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";
import { AutoDamageRollService } from "./auto-damage-roll-service.js";
import { runNelflowBoundary, runNelflowSyncBoundary } from "./nelflow-boundary.js";
import { initializeRuntimeSession } from "./runtime-session.js";
import { TransactionDiagnosticsService } from "./transaction-diagnostics-service.js";
import { TransactionStore } from "./transaction-store.js";
import { PlayerStrikeService } from "./player-strike-service.js";
import { MultiTargetStrikeCapture } from "./multi-target-strike-capture.js";
import { MultiTargetStrikeService } from "./multi-target-strike-service.js";
import { RollPopoverController } from "./roll-popover-controller.js";
import { installNelcinePublicApi } from "./nelcine-strike-delivery.js";
import { installStrikePresentationFeedApi } from "./strike-presentation-feed.js";
import { installBasicSavePresentationFeedApi } from "./basic-save-presentation-feed.js";
import {
  installEffectPublicApi,
  registerNelcineEffectHooks,
} from "./nelcine-effect-bridge.js";
import {
  installActionPublicApi,
  registerNelcineActionHooks,
} from "./nelcine-action-bridge.js";
import {
  installDefeatedPublicApi,
  registerNelcineDefeatedHooks,
} from "./nelcine-defeated-bridge.js";
import { installStrikeRidersPublicApi } from "./strike-riders.js";
import { installActionResultPresentationApi } from "./action-result-presentation.js";
import { installDamageAppliedPublicApi } from "./damage-applied-bridge.js";
import {
  installHealingPresentationFeedApi,
  registerHealingPresentationHooks,
} from "./healing-presentation-feed.js";
import { installSpellAttackPresentationFeedApi } from "./spell-attack-presentation-feed.js";
import { SpellAttackService } from "./spell-attack-service.js";

Hooks.once("init", () => {
  runNelflowSyncBoundary({ subsystem: "settings", operation: "init", task: registerSettings });
  // Presentation-neutral integration contracts must exist before any module's
  // ready handler queries them. Register synchronously at init so Toolbelt
  // compatibility and async ready work cannot race or suppress these APIs.
  runNelflowSyncBoundary({
    subsystem: "presentation-integrations",
    operation: "init-install",
    task: () => {
      installStrikePresentationFeedApi();
      installBasicSavePresentationFeedApi();
      installHealingPresentationFeedApi();
      installSpellAttackPresentationFeedApi();
    },
  });
});

Hooks.once("setup", () => {
  // Foundry initializes the ChatLog after setup but before ready. Registering
  // here lets the same read-only renderer enhance both initial history and
  // later live/batched messages.
  runNelflowSyncBoundary({ subsystem: "native-records", operation: "setup", task: () => NativeRecordsController.initialize() });
  runNelflowSyncBoundary({ subsystem: "roll-popovers", operation: "setup", task: () => RollPopoverController.initialize() });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    runNelflowSyncBoundary({
      subsystem: "chat-presentation",
      operation: "render-chat-message",
      messageId: message?.id,
      task: () => renderNelflowChat(message, html),
    });
  });
});

Hooks.once("ready", () => {
  void runNelflowBoundary({ subsystem: "startup", operation: "ready", task: initializeReady });
});

async function initializeReady() {
  initializeRuntimeSession();
  if (!PF2eAdapter.isEnvironmentSupported()) {
    logger.warn("Automation not activated", {
      stage: "ready",
      reason: `Expected PF2e on Foundry 14; found ${game.system?.id ?? "unknown"} on generation ${
        game.release?.generation ?? "unknown"
      }`,
    });
    return;
  }

  const toolbelt = ToolbeltTargetHelperAdapter.status();
  await runNelflowBoundary({ subsystem: "settings", operation: "migration", task: () => migrateSettings({ toolbeltReady: toolbelt.active && toolbelt.enabled }) });
  await runNelflowBoundary({ subsystem: "pf2e-adapter", operation: "initialize", task: () => PF2eAdapter.initialize() });
  await runNelflowBoundary({ subsystem: "autoroll", operation: "initialize", task: () => AutoDamageRollService.initialize() });
  await runNelflowBoundary({ subsystem: "legacy-save-resolver", operation: "initialize", task: () => SaveResolverService.initialize() });
  await runNelflowBoundary({ subsystem: "toolbelt-application", operation: "initialize", task: () => ToolbeltBasicSaveService.initialize() });
  await runNelflowBoundary({ subsystem: "turn-stack", operation: "initialize", task: () => TurnStackService.initialize() });
  await runNelflowBoundary({
    subsystem: "nelcine-impact",
    operation: "initialize",
    task: () => StrikeResolver.initializeImpactBridge(),
  });
  await runNelflowBoundary({
    subsystem: "nelcine-integrations",
    operation: "initialize",
    task: () => {
      installNelcinePublicApi();
      // Idempotent reinstall — contracts already registered at init.
      installStrikePresentationFeedApi();
      installBasicSavePresentationFeedApi();
      installEffectPublicApi();
      registerNelcineEffectHooks();
      installActionPublicApi();
      registerNelcineActionHooks();
      installDefeatedPublicApi();
      registerNelcineDefeatedHooks();
      installStrikeRidersPublicApi();
      installActionResultPresentationApi();
      installDamageAppliedPublicApi();
      installHealingPresentationFeedApi();
      registerHealingPresentationHooks();
      installSpellAttackPresentationFeedApi();
    },
  });
  await runNelflowBoundary({ subsystem: "multi-target-strike", operation: "capture-initialize", task: () => MultiTargetStrikeCapture.initialize() });
  await runNelflowBoundary({ subsystem: "player-strike", operation: "initialize", task: () => PlayerStrikeService.initialize() });
  await runNelflowBoundary({ subsystem: "spell-attack", operation: "initialize", task: () => SpellAttackService.initialize() });
  Hooks.on("createChatMessage", (message) => {
    void runNelflowBoundary({
      subsystem: "multi-target-strike", operation: "create-chat-message", messageId: message.id,
      transactionType: "multi-target-strike", task: () => MultiTargetStrikeService.handleCreatedMessage(message),
      onFailure: (failure) => TransactionStore.recordBoundaryFailure(message, failure),
    });
    void runNelflowBoundary({
      subsystem: "player-strike", operation: "create-chat-message", messageId: message.id,
      transactionType: "player-strike", task: () => PlayerStrikeService.handleCreatedMessage(message),
      onFailure: (failure) => TransactionStore.recordBoundaryFailure(message, failure),
    });
    void runNelflowBoundary({
      subsystem: "spell-attack", operation: "create-chat-message", messageId: message.id,
      transactionType: "spell-attack", task: () => SpellAttackService.handleCreatedMessage(message),
      onFailure: (failure) => TransactionStore.recordBoundaryFailure(message, failure),
    });
    void runNelflowBoundary({
      subsystem: "autoroll", operation: "create-chat-message", messageId: message.id,
      transactionType: "autoroll", task: () => AutoDamageRollService.handleCreatedMessage(message),
      onFailure: (failure) => AutoDamageRollService.recordBoundaryFailure(message.id, failure),
    });
    void runNelflowBoundary({
      subsystem: "strike", operation: "create-chat-message", messageId: message.id,
      transactionType: "strike", task: () => StrikeResolver.handleAttackMessage(message),
      onFailure: (failure) => TransactionStore.recordBoundaryFailure(message, failure),
    });
    void runNelflowBoundary({
      subsystem: "legacy-save-resolver", operation: "create-chat-message", messageId: message.id,
      transactionType: "legacy-save-resolver", task: () => SaveResolverService.handleMessage(message),
      onFailure: (failure) => SaveResolverService.recordBoundaryFailure(message.id, failure),
    });
    void runNelflowBoundary({
      subsystem: "toolbelt-application", operation: "create-chat-message", messageId: message.id,
      transactionType: "toolbelt-application", task: () => ToolbeltBasicSaveService.handleMessage(message),
      onFailure: (failure) => ToolbeltBasicSaveService.recordBoundaryFailure(message.id, failure),
    });
  });
  Hooks.on("updateChatMessage", (message) => {
    void runNelflowBoundary({
      subsystem: "autoroll", operation: "update-chat-message", messageId: message.id,
      transactionType: "autoroll", task: () => AutoDamageRollService.handleUpdatedMessage(message),
      onFailure: (failure) => AutoDamageRollService.recordBoundaryFailure(message.id, failure),
    });
    void runNelflowBoundary({
      subsystem: "toolbelt-application", operation: "update-chat-message", messageId: message.id,
      transactionType: "toolbelt-application", task: () => ToolbeltBasicSaveService.handleMessage(message),
      onFailure: (failure) => ToolbeltBasicSaveService.recordBoundaryFailure(message.id, failure),
    });
  });
  await runNelflowBoundary({ subsystem: "multi-target-strike", operation: "ready-reconciliation", task: () => MultiTargetStrikeService.reconcileExisting() });
  await runNelflowBoundary({ subsystem: "transaction-health", operation: "ready-reconciliation", task: () => TransactionDiagnosticsService.initialize() });

  const root = (globalThis.game.nelflow ??= {});
  root.dev = root.dev ?? {};
  root.dev.getSpellAttackStatus = () => SpellAttackService.getStatus();
  root.dev.getStatus = () => {
    const toolbelt = ToolbeltTargetHelperAdapter.status();
    return {
      moduleId: MODULE_ID,
      version: game.modules?.get?.(MODULE_ID)?.version ?? "0.14.14",
      toolbelt: {
        installed: toolbelt.installed,
        active: toolbelt.active,
        version: toolbelt.version,
        supported: toolbelt.supported,
        supportedRange: toolbelt.supportedRange,
        targetHelperEnabled: toolbelt.enabled,
        targetHelperAvailable: toolbelt.targetHelperAvailable,
        schemaCompatibility: toolbelt.schemaCompatibility,
      },
      spellAttack: SpellAttackService.getStatus(),
    };
  };
  root.dev.watchSpellAttackFlow = () => {
    SpellAttackService.watchFlow((event) => {
      try {
        if (event.event === "spell-attack-observed") {
          console.log(
            `NelFlow | SPELL ATTACK OBSERVED spell=${event.spell ?? "-"} attackMessage=${event.attackMessage} transaction=${event.transaction} target=${event.target ?? "-"} degree=${event.degree ?? "-"}`,
          );
        } else if (event.event === "spell-attack-damage-correlated") {
          console.log(
            `NelFlow | SPELL ATTACK DAMAGE CORRELATED damageMessage=${event.damageMessage} rolled=${event.rolled ?? "-"}`,
          );
        } else if (event.event === "spell-attack-applying") {
          console.log(`NelFlow | SPELL ATTACK APPLYING target=${event.target ?? "-"}`);
        } else if (event.event === "spell-attack-damage-applied") {
          console.log(
            `NelFlow | SPELL ATTACK DAMAGE APPLIED rolled=${event.rolled ?? "-"} applied=${event.applied}`,
          );
        } else if (event.event === "spell-attack-resolved") {
          console.log(`NelFlow | SPELL ATTACK RESOLVED`);
        } else if (event.event === "spell-attack-damage-skipped") {
          console.log(`NelFlow | SPELL ATTACK DAMAGE SKIPPED reason=${event.reason}`);
        }
      } catch {
        /* ignore */
      }
    });
    return { watching: true };
  };
  root.dev.stopWatchingSpellAttackFlow = () => SpellAttackService.stopWatchingFlow();

  logger.debug("Nelflow 0.14.14 ready");
}
