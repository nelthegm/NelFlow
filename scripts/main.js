import { renderNelflowChat } from "./chat-ui.js";
import { logger } from "./logger.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { registerSettings } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TurnStackService } from "./turn-stack-service.js";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  if (!PF2eAdapter.isEnvironmentSupported()) {
    logger.warn("Automation not activated", {
      stage: "ready",
      reason: `Expected PF2e on Foundry 14; found ${game.system?.id ?? "unknown"} on generation ${
        game.release?.generation ?? "unknown"
      }`,
    });
    return;
  }

  PF2eAdapter.initialize();
  TurnStackService.initialize();
  NativeRecordsController.initialize();
  Hooks.on("createChatMessage", (message) => {
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
  });
  Hooks.on("renderChatMessageHTML", renderNelflowChat);
  logger.debug("Slice 2.2 ready");
});
