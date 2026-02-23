/* eslint-disable @typescript-eslint/ban-ts-comment */

import { IDragEvent } from '@lumino/dragdrop';

import { toArray } from '@lumino/algorithm';

import { PromiseDelegate, ReadonlyJSONObject } from '@lumino/coreutils';
import { Message } from '@lumino/messaging';

import { Signal } from '@lumino/signaling';

import { DOMUtils, showErrorMessage } from '@jupyterlab/apputils';

import { JupyterFrontEnd } from '@jupyterlab/application';

import { Contents } from '@jupyterlab/services';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { renameFile } from '@jupyterlab/docmanager';

import { PathExt, IChangedArgs } from '@jupyterlab/coreutils';

import {
  DirListing,
  FileBrowser,
  FilterFileBrowserModel
} from '@jupyterlab/filebrowser';

import { ITranslator } from '@jupyterlab/translation';

import { LabIcon } from '@jupyterlab/ui-components';

import { IStateDB } from '@jupyterlab/statedb';
import { DragDropController } from './listing/DragDropController';
import { VirtualizationController } from './listing/VirtualizationController';
import { OpenStateMap } from './model/openState';
import { fetchWithFallback } from './model/treeFetchStrategy';

// @ts-ignore
import folderOpenSvgstr from '../style/icons/folder-open.svg';

/**
 * The mime type for a contents drag object.
 */
const CONTENTS_MIME = 'application/x-jupyter-icontents';

interface IBenchmarkEvent {
  type: 'tree-fetch';
  requestId: number;
  path: string;
  updatePath: string | null;
  expandedPathsCount: number;
  itemCount: number;
  clientRequestMs: number;
  clientJsonMs: number;
  clientFetchTotalMs: number;
  openStateUpdateMs: number;
  modelTotalMs: number;
  serverTreeMs: number | null;
  serverEncodeMs: number | null;
  serverTotalMs: number | null;
  serverItemCount: number | null;
  serverListedDirs: number | null;
}

interface IBenchmarkWindow extends Window {
  __JUPYTERLAB_UNFOLD_BENCHMARK_HOOK__?: (event: IBenchmarkEvent) => void;
  __JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__?: IBenchmarkEvent[];
}

interface IItemNodeRefs {
  iconContainer: HTMLElement | null;
  textContainer: HTMLElement | null;
  modifiedContainer: HTMLElement | null;
  fileSizeContainer: HTMLElement | null;
  lastIconKey?: string;
  lastDepth?: number;
}

interface ICachedItemNode extends HTMLElement {
  __jpUnfoldItemNodeRefs__?: IItemNodeRefs;
}

function emitBenchmarkEvent(event: IBenchmarkEvent): void {
  if (typeof window === 'undefined') {
    return;
  }

  const benchmarkWindow = window as IBenchmarkWindow;
  if (typeof benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_HOOK__ === 'function') {
    try {
      benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_HOOK__(event);
    } catch (error) {
      console.warn('jupyterlab-unfold benchmark hook failed', error);
    }
    return;
  }

  if (Array.isArray(benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__)) {
    benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__.push(event);
  }
}

export const folderOpenIcon = new LabIcon({
  name: 'ui-components:folder-open',
  svgstr: folderOpenSvgstr
});

/**
 * The namespace for the `FileTreeBrowser` class statics.
 */
export namespace FileTreeBrowser {
  /**
   * An options object for initializing a file tree browser widget.
   */
  export interface IOptions extends FileBrowser.IOptions {
    /**
     * A file browser model instance.
     */
    model: FilterFileTreeBrowserModel;

    /**
     * The JupyterFrontEnd app.
     */
    app: JupyterFrontEnd;
  }
}

/**
 * The namespace for the `DirTreeListing` class statics.
 */
export namespace DirTreeListing {
  /**
   * An options object for initializing a file tree listing widget.
   */
  export interface IOptions extends DirListing.IOptions {
    /**
     * A file browser model instance.
     */
    model: FilterFileTreeBrowserModel;
  }
}

/**
 * A filetree renderer.
 */
export class FileTreeRenderer extends DirListing.Renderer {
  constructor(model: FilterFileTreeBrowserModel) {
    super();

    this.model = model;
  }

  /**
   * Create the DOM node for a dir listing.
   */
  createNode(): HTMLElement {
    const node = document.createElement('div');
    const content = document.createElement('ul');
    content.className = 'jp-DirListing-content';
    node.appendChild(content);
    node.tabIndex = 1;
    return node;
  }

  populateHeaderNode(
    node: HTMLElement,
    translator?: ITranslator,
    hiddenColumns?: Set<DirListing.ToggleableColumn>
  ): void {
    // No-op we don't want any header
  }

  handleHeaderClick(
    node: HTMLElement,
    event: MouseEvent
  ): DirListing.ISortState | null {
    return null;
  }

  createItemNode(
    hiddenColumns?: Set<DirListing.ToggleableColumn>
  ): HTMLElement {
    const node = super.createItemNode(hiddenColumns);
    const cachedNode = node as ICachedItemNode;
    cachedNode.__jpUnfoldItemNodeRefs__ = {
      iconContainer: DOMUtils.findElement(node, 'jp-DirListing-itemIcon'),
      textContainer: DOMUtils.findElement(node, 'jp-DirListing-itemText'),
      modifiedContainer: DOMUtils.findElement(node, 'jp-DirListing-itemModified'),
      fileSizeContainer: DOMUtils.findElement(node, 'jp-DirListing-itemFileSize')
    };
    return node;
  }

  updateItemNode(
    node: HTMLElement,
    model: Contents.IModel,
    fileType?: DocumentRegistry.IFileType,
    translator?: ITranslator,
    hiddenColumns?: Set<DirListing.ToggleableColumn>,
    selected?: boolean
  ): void {
    if (selected) {
      node.classList.add('jp-mod-selected');
    } else {
      node.classList.remove('jp-mod-selected');
    }

    const cachedNode = node as ICachedItemNode;
    const refs = cachedNode.__jpUnfoldItemNodeRefs__ ?? {
      iconContainer: DOMUtils.findElement(node, 'jp-DirListing-itemIcon'),
      textContainer: DOMUtils.findElement(node, 'jp-DirListing-itemText'),
      modifiedContainer: DOMUtils.findElement(node, 'jp-DirListing-itemModified'),
      fileSizeContainer: DOMUtils.findElement(node, 'jp-DirListing-itemFileSize')
    };
    cachedNode.__jpUnfoldItemNodeRefs__ = refs;

    const iconContainer = refs.iconContainer;
    const textContainer = refs.textContainer;
    const modifiedContainer = refs.modifiedContainer;
    const fileSizeContainer = refs.fileSizeContainer;

    if (textContainer) {
      textContainer.textContent = model.name;
    }
    if (modifiedContainer) {
      modifiedContainer.textContent = '';
      modifiedContainer.title = '';
    }
    if (fileSizeContainer) {
      fileSizeContainer.textContent = '';
    }

    node.title = `Name: ${model.name}`;
    node.setAttribute(
      'data-file-type',
      model.type === 'directory' ? 'directory' : 'file'
    );
    node.setAttribute('data-path', model.path);
    if (model.name.startsWith('.')) {
      node.setAttribute('data-is-dot', 'true');
    } else {
      node.removeAttribute('data-is-dot');
    }

    const iconKey =
      model.type === 'directory'
        ? this.model.isOpen(model.path)
          ? 'directory:open'
          : 'directory:closed'
        : `file:${fileType?.name ?? 'default'}:${fileType?.iconClass ?? ''}`;

    if (iconContainer && refs.lastIconKey !== iconKey) {
      if (model.type === 'directory' && this.model.isOpen(model.path)) {
        folderOpenIcon.element({
          container: iconContainer,
          className: 'jp-DirListing-itemIcon',
          stylesheet: 'listing'
        });
      } else {
        LabIcon.resolveElement({
          icon: fileType?.icon,
          iconClass: fileType?.iconClass,
          container: iconContainer,
          className: 'jp-DirListing-itemIcon',
          stylesheet: 'listing'
        });
      }
      refs.lastIconKey = iconKey;
    }

    // Use lightweight CSS indentation instead of injecting per-row vbar nodes.
    const depth = model.path.split('/').length - 1;
    if (refs.lastDepth !== depth) {
      node.style.setProperty('--jp-unfold-depth', String(depth));
      refs.lastDepth = depth;
    }
  }

  private model: FilterFileTreeBrowserModel;
}

/**
 * A widget which hosts a filetree.
 */
// @ts-ignore: _onPathChanged is private upstream, need to change this
export class DirTreeListing extends DirListing {
  constructor(options: DirTreeListing.IOptions) {
    super({ ...options, renderer: new FileTreeRenderer(options.model) });
    this.addClass('jp-mod-unfold-virtualized');
    this._virtualization = new VirtualizationController();
    this._dragDrop = new DragDropController({
      contentNode: this.contentNode,
      getItemByPath: path => this._getItemByPath(path),
      isPathOpen: path => this.model.isOpen(path),
      openPath: path => {
        void this.model.toggle(path);
      }
    });
  }

  set singleClickToUnfold(value: boolean) {
    this._singleClickToUnfold = value;
  }

  get headerNode(): HTMLElement {
    return document.createElement('div');
  }

  sort(state: DirListing.ISortState): void {
    // @ts-ignore
    this._sortedItems = toArray(this.model.items());
    // @ts-ignore
    this._sortState = state;
    this.update();
  }

  protected onUpdateRequest(msg: Message): void {
    const latestItems = toArray(this.model.items());
    const allItems = this._virtualization.resolveAllItems(latestItems);

    const virtualWindow = this._virtualization.computeWindow(
      allItems,
      this.contentNode
    );
    if (!virtualWindow.virtualized) {
      this._virtualization.clearSpacers();
      super.onUpdateRequest(msg);
      return;
    }

    // @ts-ignore private fields from DirListing
    this._isDirty = false;
    // @ts-ignore private fields from DirListing
    const nodes = this._items as HTMLElement[];
    // @ts-ignore private fields from DirListing
    const renderer = this._renderer as DirListing.IRenderer;
    const content = this.contentNode;

    this._virtualization.applySpacers(
      content,
      virtualWindow.topPx,
      virtualWindow.bottomPx
    );

    while (nodes.length > virtualWindow.visibleItems.length) {
      content.removeChild(nodes.pop()!);
    }

    while (nodes.length < virtualWindow.visibleItems.length) {
      // @ts-ignore signature variations across JupyterLab versions
      const node = renderer.createItemNode(this._hiddenColumns, this._columnSizes);
      node.classList.add('jp-DirListing-item');
      nodes.push(node);
      if (this._virtualization.bottomSpacer?.parentElement === content) {
        content.insertBefore(node, this._virtualization.bottomSpacer);
      } else {
        content.appendChild(node);
      }
    }

    nodes.forEach((node, i) => {
      node.classList.remove('jp-mod-selected');
      node.classList.remove('jp-mod-running');
      node.classList.remove('jp-mod-cut');

      const checkbox = renderer.getCheckboxNode(node);
      if (checkbox) {
        checkbox.checked = false;
      }

      const nameNode = renderer.getNameNode(node);
      if (!nameNode) {
        return;
      }
      // @ts-ignore private focus index
      if (i + virtualWindow.rangeStart === this._focusIndex) {
        nameNode.setAttribute('tabIndex', '0');
        nameNode.setAttribute('role', 'button');
      } else {
        nameNode.setAttribute('tabIndex', '-1');
        nameNode.removeAttribute('role');
      }
    });

    // Keep sortedItems as the full model list so any fallback update path
    // still has complete item metadata.
    // @ts-ignore private field from DirListing
    this._sortedItems = allItems;
    // @ts-ignore private/protected visibility mismatch in extension context
    this.updateNodes(virtualWindow.visibleItems, nodes);
    this._virtualization.setRenderedWindow(
      virtualWindow.rangeStart,
      virtualWindow.visibleItems.length
    );

    // @ts-ignore private field from DirListing
    this._prevPath = this._model.path;
  }

  get model(): FilterFileTreeBrowserModel {
    // @ts-ignore
    return this._model;
  }

  private async _eventDblClick(event: MouseEvent): Promise<void> {
    const entry = this.entryForClick(event);

    if (entry?.type === 'directory') {
      if (!this._singleClickToUnfold) {
        this.model.toggle(entry.path);
      }
    } else {
      super.handleEvent(event);
    }
  }

  _onPathChanged(): void {
    // It's a no-op to overwrite the base class behavior
    // We don't want to deselect everything when the path changes
  }

  private _eventDragEnter(event: IDragEvent): void {
    if (!event.mimeData.hasData(CONTENTS_MIME)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dropAction = event.proposedAction;
    this._dragDrop.updateDragState(
      event.clientX,
      event.clientY,
      event.target as HTMLElement | null
    );
  }

  private _eventDragOver(event: IDragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.dropAction = event.proposedAction;
    this._dragDrop.updateDragState(
      event.clientX,
      event.clientY,
      event.target as HTMLElement | null
    );
  }

  private _eventDrop(event: IDragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // @ts-ignore
    clearTimeout(this._selectTimer);
    if (event.proposedAction === 'none') {
      event.dropAction = 'none';
      this._dragDrop.cleanup();
      return;
    }
    if (!event.mimeData.hasData(CONTENTS_MIME)) {
      this._dragDrop.cleanup();
      return;
    }

    let newDir = '';
    const targetPath = this._dragDrop.activeDropTargetPath;
    const targetItem = targetPath ? this._getItemByPath(targetPath) : null;
    if (targetItem) {
      newDir =
        targetItem.type === 'directory'
          ? targetItem.path
          : PathExt.dirname(targetItem.path);
    }

    // @ts-ignore
    const manager = this._manager;

    // Handle the items.
    const promises: Promise<Contents.IModel | null>[] = [];
    const paths = event.mimeData.getData(CONTENTS_MIME) as string[];

    if (event.ctrlKey && event.proposedAction === 'move') {
      event.dropAction = 'copy';
    } else {
      event.dropAction = event.proposedAction;
    }
    for (const path of paths) {
      const localPath = manager.services.contents.localPath(path);
      const name = PathExt.basename(localPath);
      const newPath = PathExt.join(newDir, name);
      // Skip files that are not moving.
      if (newPath === path) {
        continue;
      }

      if (event.dropAction === 'copy') {
        promises.push(manager.copy(path, newDir));
      } else {
        promises.push(renameFile(manager, path, newPath));
      }
    }
    Promise.all(promises).catch(error => {
      void showErrorMessage(
        // @ts-ignore
        this._trans._p('showErrorMessage', 'Error while copying/moving files'),
        error
      );
    });
    this._dragDrop.cleanup();
  }

  private _eventDragLeave(event: IDragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this._dragDrop.handleDragLeave(event.clientX, event.clientY, this.node);
  }

  /**
   * Handle 'mousedown' event
   *
   * Note: This allow to change the path to the root and clear selection when the user
   * is clicking on an empty space.
   */
  private _eventMouseDown(event: MouseEvent): void {
    const entry = this.entryForClick(event);

    if (entry) {
      if (entry.type === 'directory') {
        this.model.path = '/' + entry.path;

        if (this._singleClickToUnfold && event.button === 0) {
          this.model.toggle(entry.path);
        }
      } else {
        this.model.path = '/' + PathExt.dirname(entry.path);
      }
    } else {
      // TODO Upstream this logic to JupyterLab (clearing selection when clicking the empty space)?
      this.clearSelectedItems();
      this.update();

      this.model.path = this.model.rootPath;
    }
  }

  handleEvent(event: Event): void {
    switch (event.type) {
      case 'dblclick':
        this._eventDblClick(event as MouseEvent);
        break;
      case 'lm-dragenter':
        this._eventDragEnter(event as IDragEvent);
        break;
      case 'lm-dragover':
        this._eventDragOver(event as IDragEvent);
        break;
      case 'lm-dragleave':
        this._eventDragLeave(event as IDragEvent);
        break;
      case 'lm-drop':
        this._eventDrop(event as IDragEvent);
        break;
      case 'mousedown':
        super.handleEvent(event);
        this._eventMouseDown(event as MouseEvent);
        break;
      case 'scroll':
        if (this.shouldVirtualize()) {
          const scrollTarget = event.target as EventTarget | null;
          if (scrollTarget === this.contentNode) {
            this._virtualization.scheduleUpdate(
              this.contentNode,
              () => this._virtualization.resolveAllItems(toArray(this.model.items())),
              () => this.update()
            );
          }
        }
        super.handleEvent(event);
        break;
      default:
        super.handleEvent(event);
        break;
    }
  }

  protected onBeforeDetach(msg: Message): void {
    this._dragDrop.cleanup();
    this._virtualization.cancelUpdate();
    super.onBeforeDetach(msg);
  }

  private _singleClickToUnfold = true;
  private _virtualization: VirtualizationController;
  private _dragDrop: DragDropController;

  private shouldVirtualize(itemCount?: number): boolean {
    const count =
      itemCount ??
      this._virtualization.resolveAllItems(toArray(this.model.items())).length;
    return this._virtualization.shouldVirtualize(count);
  }

  private entryForClick(event: MouseEvent): Contents.IModel | null {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('.jp-DirListing-item') as HTMLElement | null;
    const rowPath = row?.getAttribute('data-path');
    if (rowPath) {
      const matched = toArray(this.model.items()).find(item => item.path === rowPath);
      if (matched) {
        return matched;
      }
    }

    if (!this.shouldVirtualize()) {
      return this.modelForClick(event) ?? null;
    }
    return null;
  }

  private _getItemByPath(path: string): Contents.IModel | null {
    return toArray(this.model.items()).find(item => item.path === path) ?? null;
  }
}

/**
 * Filetree browser model with optional filter on element.
 */
export class FilterFileTreeBrowserModel extends FilterFileBrowserModel {
  constructor(options: FilterFileBrowserModel.IOptions) {
    super(options);

    this.contentManager = this.manager.services.contents;

    this._savedState = options.state || null;

    this._path = this.rootPath;
  }

  get path(): string {
    return this._path;
  }

  set path(value: string) {
    let needsToEmit = false;

    if (this._path !== value) {
      needsToEmit = true;
    }

    const oldValue = this._path;
    this._path = value;

    if (needsToEmit) {
      const pathChanged = this.pathChanged as Signal<
        this,
        IChangedArgs<string>
      >;

      pathChanged.emit({
        name: 'path',
        oldValue,
        newValue: this._path
      });
    }
  }

  /**
   * Change directory.
   *
   * @param path - The path to the file or directory.
   *
   * @returns A promise with the contents of the directory.
   */
  async cd(pathToUpdate = this.rootPath): Promise<void> {
    const shouldForceRefresh = pathToUpdate === '.';
    if (shouldForceRefresh) {
      this.clearDirectoryCache();
    }

    const result = await this.fetchContent(this.rootPath, pathToUpdate);

    // @ts-ignore
    this.handleContents({
      name: this.rootPath,
      path: this.rootPath,
      type: 'directory',
      content: result
    });

    if (this._savedState && this._stateKey) {
      void this._savedState.save(this._stateKey, { openState: this.openState });
    }

    this.onRunningChanged(
      this.manager.services.sessions,
      this.manager.services.sessions.running()
    );
  }

  /**
   * A promise that resolves when the model is first restored.
   */
  get restored(): Promise<void> {
    return this._isRestored.promise;
  }

  /**
   * Restore the state of the file browser.
   *
   * @param id - The unique ID that is used to construct a state database key.
   *
   * @param populate - If `false`, the restoration ID will be set but the file
   * browser state will not be fetched from the state database.
   *
   * @returns A promise when restoration is complete.
   *
   * #### Notes
   * This function will only restore the model *once*. If it is called multiple
   * times, all subsequent invocations are no-ops.
   */
  async restore(id: string, populate = true): Promise<void> {
    const { manager } = this;
    const key = `file-browser-${id}:openState`;
    const state = this._savedState;
    const restored = !!this._stateKey;

    if (restored) {
      return;
    }

    // Set the file browser key for state database fetch/save.
    this._stateKey = key;

    if (!populate || !state) {
      this._isRestored.resolve(undefined);
      return;
    }

    await manager.services.ready;

    try {
      const value = await state.fetch(key);

      if (!value) {
        await this.cd(this.rootPath);
        this._isRestored.resolve(undefined);
        return;
      }

      this.openState = (value as ReadonlyJSONObject)['openState'] as {
        [path: string]: boolean;
      };
      await this.cd(this.rootPath);
    } catch (error) {
      await this.cd(this.rootPath);
      await state.remove(key);
    }

    this._isRestored.resolve(undefined);
  }

  /**
   * Open/close directories to discover/hide a given path.
   *
   * @param pathToToggle - The path to discover/hide.
   */
  async toggle(pathToToggle = this.rootPath): Promise<void> {
    this.openState[pathToToggle] = !this.openState[pathToToggle];

    // Refresh
    this.cd(this.rootPath);
  }

  /**
   * Check whether a directory path is opened or not.
   *
   * @param path - The given path
   *
   * @returns Whether the directory is opened or not.
   *
   */
  isOpen(path: string): boolean {
    return !!this.openState[path];
  }

  private async fetchContent(
    path: string,
    pathToUpdate?: string
  ): Promise<Contents.IModel[]> {
    const modelStart = performance.now();
    const result = await fetchWithFallback({
      path,
      pathToUpdate,
      openState: this.openState,
      serverSettings: this.serverSettings,
      getDirectoryContents: async dirPath => this.getDirectoryContents(dirPath)
    });

    if (result.source === 'server' && result.diagnostics && result.serverMetadata) {
      emitBenchmarkEvent({
        type: 'tree-fetch',
        requestId: result.diagnostics.requestId,
        path,
        updatePath: result.serverMetadata.normalizedUpdatePath ?? null,
        expandedPathsCount: result.serverMetadata.expandedPathsCount,
        itemCount: result.items.length,
        clientRequestMs: result.diagnostics.requestMs,
        clientJsonMs: result.diagnostics.jsonMs,
        clientFetchTotalMs: result.diagnostics.totalMs,
        openStateUpdateMs: result.serverMetadata.openStateUpdateMs,
        modelTotalMs: performance.now() - modelStart,
        serverTreeMs: result.diagnostics.serverTreeMs,
        serverEncodeMs: result.diagnostics.serverEncodeMs,
        serverTotalMs: result.diagnostics.serverTotalMs,
        serverItemCount: result.diagnostics.serverItemCount,
        serverListedDirs: result.diagnostics.serverListedDirs
      });
    }
    return result.items;
  }

  /**
   * Sort the entries
   *
   * @param data: The entries to sort
   * @returns the sorted entries
   */
  private sortContents(data: Contents.IModel[]): Contents.IModel[] {
    const directories = data.filter(value => value.type === 'directory');
    const files = data.filter(value => value.type !== 'directory');

    const sortedDirectories = directories.sort((a, b) =>
      this.compareByName(a.name, b.name)
    );
    const sortedFiles = files.sort((a, b) =>
      this.compareByName(a.name, b.name)
    );

    return sortedDirectories.concat(sortedFiles);
  }

  protected onFileChanged(
    sender: Contents.IManager,
    change: Contents.IChangedArgs
  ): void {
    this.clearDirectoryCache();
    this.refresh();
  }

  private async getDirectoryContents(path: string): Promise<Contents.IModel[]> {
    const cached = this._directoryCache.get(path);
    if (cached) {
      return cached;
    }

    const result = await this.contentManager.get(path);
    const sortedContent = result.content ? this.sortContents(result.content) : [];
    this._directoryCache.set(path, sortedContent);
    return sortedContent;
  }

  private clearDirectoryCache(): void {
    this._directoryCache.clear();
  }

  private _isRestored = new PromiseDelegate<void>();
  private _savedState: IStateDB | null = null;
  private _stateKey: string | null = null;
  private _path: string;
  private contentManager: Contents.IManager;
  private serverSettings = this.manager.services.serverSettings;
  private openState: OpenStateMap = {};
  private _directoryCache = new Map<string, Contents.IModel[]>();

  private compareByName(a: string, b: string): number {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }
}

/**
 * The filetree browser.
 */
export class FileTreeBrowser extends FileBrowser {
  constructor(options: FileTreeBrowser.IOptions) {
    super(options);

    this.mainPanel.layout?.removeWidget(this.crumbs);

    this.showLastModifiedColumn = false;
    this.showFileCheckboxes = false;
  }

  get showFileCheckboxes(): boolean {
    return false;
  }

  set showFileCheckboxes(value: boolean) {
    if (this.listing.setColumnVisibility) {
      this.listing.setColumnVisibility('is_selected', false);
      // @ts-ignore
      this._showFileCheckboxes = false;
    }
  }

  get showLastModifiedColumn(): boolean {
    return false;
  }

  set showLastModifiedColumn(value: boolean) {
    if (this.listing.setColumnVisibility) {
      this.listing.setColumnVisibility('last_modified', false);
    }
  }

  protected createDirListing(options: DirListing.IOptions): DirListing {
    // @ts-ignore: _onPathChanged is private upstream, need to change this
    return new DirTreeListing({
      model: this.model,
      translator: this.translator
    });
  }

  set useFuzzyFilter(value: boolean) {
    // No-op
  }

  model: FilterFileTreeBrowserModel;

  // @ts-ignore: _onPathChanged is private upstream, need to change this
  listing: DirTreeListing;
}
