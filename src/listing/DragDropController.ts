const DROP_TARGET_CLASS = 'jp-mod-dropTarget';
const SPRING_LOAD_DELAY_MS = 500;
const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_MAX_PX_PER_FRAME = 20;

export interface IDragDropControllerOptions {
  contentNode: HTMLElement;
  getItemByPath: (path: string) => { type: string } | null;
  isPathOpen: (path: string) => boolean;
  openPath: (path: string) => void;
}

export class DragDropController {
  constructor(options: IDragDropControllerOptions) {
    this._contentNode = options.contentNode;
    this._getItemByPath = options.getItemByPath;
    this._isPathOpen = options.isPathOpen;
    this._openPath = options.openPath;
  }

  get activeDropTargetPath(): string | null {
    return this._activeDropTargetPath;
  }

  updateDragState(
    clientX: number,
    clientY: number,
    target?: HTMLElement | null
  ): void {
    this._dragInProgress = true;
    this._edgePointerClientX = clientX;
    this._edgePointerClientY = clientY;
    this.setDropTargetPath(this.rowPathAtPoint(clientX, clientY, target));
    this._edgeScrollVelocity = this.computeEdgeScrollVelocity(clientY);
    if (this._edgeScrollVelocity !== 0) {
      this.startEdgeAutoScroll();
    } else {
      this.stopEdgeAutoScroll();
    }
  }

  cleanup(): void {
    this._dragInProgress = false;
    this.setDropTargetPath(null);
    this.cancelSpringHover();
    this._springOpenedPaths.clear();
    this.stopEdgeAutoScroll();
  }

  handleDragLeave(clientX: number, clientY: number, rootNode: HTMLElement): void {
    if (rootNode && rootNode.contains(document.elementFromPoint(clientX, clientY))) {
      return;
    }
    this.cleanup();
  }

  private rowPathAtPoint(
    clientX: number,
    clientY: number,
    target?: HTMLElement | null
  ): string | null {
    const directRow = target?.closest('.jp-DirListing-item') as HTMLElement | null;
    if (directRow) {
      return directRow.getAttribute('data-path');
    }
    const hovered = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const row = hovered?.closest('.jp-DirListing-item') as HTMLElement | null;
    return row?.getAttribute('data-path') ?? null;
  }

  private setDropTargetPath(path: string | null): void {
    if (this._activeDropTargetPath === path) {
      return;
    }

    const previousPath = this._activeDropTargetPath;
    if (previousPath) {
      const previousNode = this._contentNode.querySelector(
        `.jp-DirListing-item[data-path="${CSS.escape(previousPath)}"]`
      );
      previousNode?.classList.remove(DROP_TARGET_CLASS);
    }

    this._activeDropTargetPath = path;

    if (!path) {
      this.cancelSpringHover();
      return;
    }

    const node = this._contentNode.querySelector(
      `.jp-DirListing-item[data-path="${CSS.escape(path)}"]`
    );
    node?.classList.add(DROP_TARGET_CLASS);
    this.updateSpringHover(path);
  }

  private updateSpringHover(path: string): void {
    const item = this._getItemByPath(path);
    const shouldSpring =
      !!item &&
      item.type === 'directory' &&
      !this._isPathOpen(path) &&
      !this._springOpenedPaths.has(path);

    if (!shouldSpring) {
      this.cancelSpringHover();
      return;
    }

    if (this._springHoverPath === path && this._springHoverTimer !== 0) {
      return;
    }

    this.cancelSpringHover();
    this._springHoverPath = path;
    this._springHoverTimer = window.setTimeout(() => {
      const hoverPath = this._springHoverPath;
      if (!hoverPath || hoverPath !== path || this._isPathOpen(path)) {
        return;
      }
      this._springOpenedPaths.add(path);
      this._openPath(path);
    }, SPRING_LOAD_DELAY_MS);
  }

  private cancelSpringHover(): void {
    this._springHoverPath = null;
    if (this._springHoverTimer !== 0) {
      window.clearTimeout(this._springHoverTimer);
      this._springHoverTimer = 0;
    }
  }

  private computeEdgeScrollVelocity(clientY: number): number {
    const rect = this._contentNode.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) {
      return 0;
    }

    const topDistance = clientY - rect.top;
    if (topDistance < EDGE_SCROLL_ZONE_PX) {
      const ratio = 1 - topDistance / EDGE_SCROLL_ZONE_PX;
      return -EDGE_SCROLL_MAX_PX_PER_FRAME * ratio * ratio;
    }

    const bottomDistance = rect.bottom - clientY;
    if (bottomDistance < EDGE_SCROLL_ZONE_PX) {
      const ratio = 1 - bottomDistance / EDGE_SCROLL_ZONE_PX;
      return EDGE_SCROLL_MAX_PX_PER_FRAME * ratio * ratio;
    }

    return 0;
  }

  private startEdgeAutoScroll(): void {
    if (this._edgeScrollRaf !== 0) {
      return;
    }

    const step = () => {
      this._edgeScrollRaf = 0;
      if (!this._dragInProgress || this._edgeScrollVelocity === 0) {
        return;
      }

      const content = this._contentNode;
      const nextScrollTop = Math.max(
        0,
        Math.min(
          content.scrollHeight - content.clientHeight,
          content.scrollTop + this._edgeScrollVelocity
        )
      );

      if (nextScrollTop !== content.scrollTop) {
        content.scrollTop = nextScrollTop;
      }

      this.setDropTargetPath(
        this.rowPathAtPoint(this._edgePointerClientX, this._edgePointerClientY)
      );
      this._edgeScrollVelocity = this.computeEdgeScrollVelocity(
        this._edgePointerClientY
      );

      if (this._edgeScrollVelocity !== 0) {
        this._edgeScrollRaf = window.requestAnimationFrame(step);
      }
    };

    this._edgeScrollRaf = window.requestAnimationFrame(step);
  }

  private stopEdgeAutoScroll(): void {
    if (this._edgeScrollRaf !== 0) {
      window.cancelAnimationFrame(this._edgeScrollRaf);
      this._edgeScrollRaf = 0;
    }
    this._edgeScrollVelocity = 0;
  }

  private _contentNode: HTMLElement;
  private _getItemByPath: (path: string) => { type: string } | null;
  private _isPathOpen: (path: string) => boolean;
  private _openPath: (path: string) => void;
  private _dragInProgress = false;
  private _activeDropTargetPath: string | null = null;
  private _springHoverPath: string | null = null;
  private _springHoverTimer = 0;
  private _springOpenedPaths = new Set<string>();
  private _edgeScrollRaf = 0;
  private _edgeScrollVelocity = 0;
  private _edgePointerClientX = 0;
  private _edgePointerClientY = 0;
}
