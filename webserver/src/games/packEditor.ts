import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import type { QuizPack } from "./pack.js";

/**
 * Represents a pack being edited, with its JSON and associated media files.
 */
interface EditedPack {
  pack: QuizPack;
  media: Map<string, Buffer>;
}

/**
 * In-memory store for packs currently being edited.
 * Edits are session-scoped (per-party) and never written to games/.
 */
export class PackEditorStore {
  private readonly editedPacks = new Map<string, EditedPack>();

  /**
   * Starts editing a pack. The pack is cloned and stored in memory.
   * Returns an editor session ID.
   */
  public startEditing(pack: QuizPack, existingMedia: Map<string, Buffer>): string {
    const editorId = randomUUID();
    this.editedPacks.set(editorId, {
      pack: structuredClone(pack),
      media: new Map(existingMedia),
    });
    return editorId;
  }

  /**
   * Gets the pack being edited.
   */
  public get(editorId: string): QuizPack | undefined {
    return this.editedPacks.get(editorId)?.pack;
  }

  /**
   * Updates the pack being edited.
   */
  public update(editorId: string, pack: QuizPack): void {
    const entry = this.editedPacks.get(editorId);
    if (!entry) throw new Error("Editor session not found");
    entry.pack = structuredClone(pack);
  }

  /**
   * Adds a media file to the edited pack.
   * Returns the relative path to use in the pack JSON.
   */
  public addMedia(editorId: string, filename: string, buffer: Buffer): string {
    const entry = this.editedPacks.get(editorId);
    if (!entry) throw new Error("Editor session not found");
    entry.media.set(filename, buffer);
    return filename;
  }

  /**
   * Exports the edited pack as a ZIP buffer.
   */
  public exportAsZip(editorId: string): Buffer {
    const entry = this.editedPacks.get(editorId);
    if (!entry) throw new Error("Editor session not found");

    const zip = new AdmZip();

    // * Add pack JSON
    const packJson = JSON.stringify(entry.pack, null, 2);
    zip.addFile("pack.json", Buffer.from(packJson, "utf8"));

    // * Add media files
    for (const [filename, buffer] of entry.media) {
      zip.addFile(filename, buffer);
    }

    return zip.toBuffer();
  }

  /**
   * Closes an editor session and frees memory.
   */
  public close(editorId: string): void {
    this.editedPacks.delete(editorId);
  }

  /**
   * Gets all media files for a pack being edited.
   */
  public getMedia(editorId: string): Map<string, Buffer> | undefined {
    return this.editedPacks.get(editorId)?.media;
  }
}
