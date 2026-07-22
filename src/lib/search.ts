/**
 * Compat: el WaitingFlow vive en waiting-flow.ts (Sprint 27).
 * Handler/cron siguen importando desde aquí.
 */
export {
  SEARCH_CONTINUE_PREFIX,
  SEARCH_CANCEL_PREFIX,
  NO_DRIVER_MESSAGE,
  searchContinueButtonId,
  searchCancelButtonId,
  parseSearchContinueButton,
  parseSearchCancelButton,
  computeSearchDeadlines,
  shouldPromptContinueSearch,
  shouldAutoCancelMaxWait,
  shouldAutoCancelSearch,
  closeSearchWithoutDriver,
  processDueWaitingFlow,
  processDueSearchTimeouts,
  handleSearchContinue,
  handleSearchCancel,
} from "@/lib/waiting-flow";
