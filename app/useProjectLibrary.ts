import { useEffect, useSyncExternalStore, useState } from "react";
import { ProjectLibrary } from "./library";

let library: ProjectLibrary | undefined;
export function useProjectLibrary() {
  const [controller] = useState(() => library ??= new ProjectLibrary());
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return { ...state, controller };
}
