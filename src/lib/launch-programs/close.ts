/**
 * Reexport — cierre unificado del programa (BUG-PIONEERS-003).
 * Preferir import desde aquí o desde `@/lib/launch-programs/config`.
 */

export {
  closeLaunchProgram,
  processDueLaunchProgramClosures,
  drainLaunchOutboundQueueFully,
  type CloseLaunchProgramResult,
  type CloseLaunchSource,
} from "@/lib/launch-programs/config";
