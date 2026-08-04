import { renderNelflowChat } from "./chat-ui.js";
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

Hooks.once("init", () => {
  runNelflowSyncBoundary({ subsystem: "settings", operation: "init", task: registerSettings });
});

Hooks.once("setup", () => {
  // Foundry initializes the ChatLog after setup but before ready. Registering
  // here lets the same read-only renderer enhance both initial history and
  // later live/batched messages.
  runNelflowSyncBoundary({ subsystem: "native-records", operation: "setup", task: () => NativeRecordsController.initialize() });
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
  await runNelflowBoundary({ subsystem: "player-strike", operation: "initialize", task: () => PlayerStrikeService.initialize() });
  Hooks.on("createChatMessage", (message) => {
    void runNelflowBoundary({
      subsystem: "player-strike", operation: "create-chat-message", messageId: message.id,
      transactionType: "player-strike", task: () => PlayerStrikeService.handleCreatedMessage(message),
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
  await runNelflowBoundary({ subsystem: "transaction-health", operation: "ready-reconciliation", task: () => TransactionDiagnosticsService.initialize() });
  logger.debug("Nelflow 0.6.5 ready");
}
