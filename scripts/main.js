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

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("setup", () => {
  // Foundry initializes the ChatLog after setup but before ready. Registering
  // here lets the same read-only renderer enhance both initial history and
  // later live/batched messages.
  NativeRecordsController.initialize();
  Hooks.on("renderChatMessageHTML", renderNelflowChat);
});

Hooks.once("ready", () => {
  void initializeReady().catch((error) => {
    logger.error("Ready initialization failed", {
      stage: "ready",
      reason: error instanceof Error ? error.message : String(error),
    }, error);
  });
});

async function initializeReady() {
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
  await migrateSettings({ toolbeltReady: toolbelt.active && toolbelt.enabled });
  PF2eAdapter.initialize();
  AutoDamageRollService.initialize();
  SaveResolverService.initialize();
  ToolbeltBasicSaveService.initialize();
  TurnStackService.initialize();
  Hooks.on("createChatMessage", (message) => {
    void AutoDamageRollService.handleCreatedMessage(message).catch((error) => {
      logger.error("Unhandled automatic damage-message error", {
        stage: "createChatMessage",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
    });
    void StrikeResolver.handleAttackMessage(message).catch((error) => {
      logger.error(
        "Unhandled attack-message error",
        {
          attackMessageId: message.id,
          stage: "createChatMessage",
          reason: error instanceof Error ? error.message : String(error),
        },
        error,
      );
    });
    void SaveResolverService.handleMessage(message).catch((error) => {
      logger.error(
        "Unhandled spell-source message error",
        {
          sourceMessageId: message.id,
          stage: "createChatMessage",
          reason: error instanceof Error ? error.message : String(error),
        },
        error,
      );
    });
    void ToolbeltBasicSaveService.handleMessage(message).catch((error) => {
      logger.error("Unhandled Toolbelt damage-message error", {
        stage: "createChatMessage",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
    });
  });
  Hooks.on("updateChatMessage", (message) => {
    void AutoDamageRollService.handleUpdatedMessage(message).catch((error) => {
      logger.error("Unhandled automatic damage-message update error", {
        stage: "updateChatMessage",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
    });
    void ToolbeltBasicSaveService.handleMessage(message).catch((error) => {
      logger.error("Unhandled Toolbelt message-update error", {
        stage: "updateChatMessage",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
    });
  });
  logger.debug("Slice 3.3 ready");
}
