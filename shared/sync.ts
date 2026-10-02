import { z } from "zod";
import type { Project } from "../app/domain.js";

const shortString = z.string().max(500);
const identifiers = z.record(z.string().max(200), z.string().max(200));
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(128),
  title: shortString,
  source: z.object({
    type: z.enum(["abc", "musicxml", "mxl", "midi"]),
    content: z.string().max(16 * 1024 * 1024),
    fileName: shortString.optional(),
    tempoBpm: z.number().positive().max(10000).optional(),
    trackCount: z.number().int().nonnegative().optional(),
    voiceCount: z.number().int().nonnegative().optional(),
  }),
  normalizedMei: z.string().max(16 * 1024 * 1024),
  selectedPart: shortString,
  selectedVoice: shortString,
  tuning: z.enum(["C", "D", "F", "G"]),
  tuningMode: z.enum(["original-key", "preserve-fingerings"]),
  octaveShift: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  tempoPercent: z.number().min(25).max(200),
  sound: z.object({
    preset: z.enum(["clean", "soft", "bright", "custom"]),
    breath: z.number().min(0).max(100),
    brightness: z.number().min(0).max(100),
    vibrato: z.number().min(0).max(100),
  }),
  fingeringOverrides: identifiers,
  chordResolutions: identifiers,
  display: z.object({ showNoteNames: z.boolean(), showFingerings: z.boolean() }),
  updatedAt: z.string().datetime(),
});

export const operationSchema = z.object({
  operationId: z.string().uuid(),
  id: z.string().min(1).max(128),
  project: projectSchema.nullable(),
}).refine((value) => !value.project || value.project.id === value.id, {
  message: "Project ID does not match operation ID",
});

export interface ProjectOperation {
  operationId: string;
  id: string;
  project: Project | null;
}

export interface RemoteProject {
  id: string;
  project: Project | null;
  revision: number;
  updatedAt: string;
}

export interface ProjectChanges {
  changes: RemoteProject[];
  cursor: number;
  hasMore: boolean;
}
