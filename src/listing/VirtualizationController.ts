import { Contents } from '@jupyterlab/services';

export interface IVirtualizationWindow {
  allItems: Contents.IModel[];
  visibleItems: Contents.IModel[];
  rangeStart: number;
  topPx: number;
  bottomPx: number;
  virtualized: boolean;
}

export interface IVirtualizationControllerOptions {
  threshold?: number;
  rowHeight?: number;
  overscanRows?: number;
  minRows?: number;
}

export class VirtualizationController {
  constructor(options: IVirtualizationControllerOptions = {}) {
    this._threshold = options.threshold ?? 2500;
    this._rowHeight = options.rowHeight ?? 24;
    this._overscanRows = options.overscanRows ?? 80;
    this._minRows = options.minRows ?? 200;
  }

  resolveAllItems(latestItems: Contents.IModel[]): Contents.IModel[] {
    if (latestItems.length > 0) {
      this._lastNonEmptyItems = latestItems;
    }
    return latestItems.length > 0 ? latestItems : this._lastNonEmptyItems;
  }

  shouldVirtualize(itemCount: number): boolean {
    return itemCount >= this._threshold;
  }

  computeWindow(allItems: Contents.IModel[], contentNode: HTMLElement): IVirtualizationWindow {
    if (!this.shouldVirtualize(allItems.length)) {
      this._lastRange = { start: -1, end: -1 };
      return {
        allItems,
        visibleItems: allItems,
        rangeStart: 0,
        topPx: 0,
        bottomPx: 0,
        virtualized: false
      };
    }

    const range = this.computeVisibleRange(allItems.length, contentNode);
    const visibleItems = allItems.slice(range.start, range.end);
    const topPx = range.start * this._rowHeight;
    const bottomPx = Math.max(0, allItems.length - range.end) * this._rowHeight;

    return {
      allItems,
      visibleItems,
      rangeStart: range.start,
      topPx,
      bottomPx,
      virtualized: true
    };
  }

  applySpacers(contentNode: HTMLElement, topPx: number, bottomPx: number): void {
    if (!this._topSpacer) {
      this._topSpacer = document.createElement('li');
      this._topSpacer.className = 'jp-unfold-virtual-spacer';
    }
    if (!this._bottomSpacer) {
      this._bottomSpacer = document.createElement('li');
      this._bottomSpacer.className = 'jp-unfold-virtual-spacer';
    }

    this._topSpacer.style.height = `${Math.max(0, topPx)}px`;
    this._bottomSpacer.style.height = `${Math.max(0, bottomPx)}px`;
    contentNode.insertBefore(this._topSpacer, contentNode.firstChild);
    contentNode.appendChild(this._bottomSpacer);
  }

  clearSpacers(): void {
    if (this._topSpacer?.parentElement) {
      this._topSpacer.parentElement.removeChild(this._topSpacer);
    }
    if (this._bottomSpacer?.parentElement) {
      this._bottomSpacer.parentElement.removeChild(this._bottomSpacer);
    }
    this._lastRange = { start: -1, end: -1 };
    this._lastRenderedRangeStart = 0;
    this._lastRenderedVisibleCount = 0;
    this.cancelUpdate();
  }

  setRenderedWindow(rangeStart: number, visibleCount: number): void {
    this._lastRenderedRangeStart = rangeStart;
    this._lastRenderedVisibleCount = visibleCount;
  }

  get bottomSpacer(): HTMLElement | null {
    return this._bottomSpacer;
  }

  scheduleUpdate(
    contentNode: HTMLElement,
    getAllItems: () => Contents.IModel[],
    requestUpdate: () => void
  ): void {
    if (this._updateRaf !== 0) {
      return;
    }
    this._updateRaf = window.requestAnimationFrame(() => {
      this._updateRaf = 0;
      const allItems = getAllItems();
      const nextRange = this.computeVisibleRange(allItems.length, contentNode);
      const renderedEnd =
        this._lastRenderedRangeStart + this._lastRenderedVisibleCount;
      if (
        nextRange.start !== this._lastRenderedRangeStart ||
        nextRange.end !== renderedEnd
      ) {
        requestUpdate();
      }
    });
  }

  cancelUpdate(): void {
    if (this._updateRaf !== 0) {
      window.cancelAnimationFrame(this._updateRaf);
      this._updateRaf = 0;
    }
  }

  private computeVisibleRange(
    totalItems: number,
    contentNode: HTMLElement
  ): { start: number; end: number } {
    if (totalItems <= 0) {
      this._lastRange = { start: 0, end: 0 };
      return this._lastRange;
    }

    const viewportHeight = Math.max(contentNode.clientHeight, this._rowHeight);
    const visibleRows = Math.max(
      this._minRows,
      Math.ceil(viewportHeight / this._rowHeight)
    );
    const scrollTop = Math.max(0, contentNode.scrollTop);
    const maxFirstVisible = Math.max(0, totalItems - 1);
    const firstVisible = Math.min(
      maxFirstVisible,
      Math.floor(scrollTop / this._rowHeight)
    );
    const start = Math.max(0, firstVisible - this._overscanRows);
    const unclampedEnd = Math.min(
      totalItems,
      firstVisible + visibleRows + this._overscanRows
    );
    const end = Math.max(start + 1, unclampedEnd);

    if (this._lastRange.start === start && this._lastRange.end === end) {
      return this._lastRange;
    }

    this._lastRange = { start, end };
    return this._lastRange;
  }

  private _threshold: number;
  private _rowHeight: number;
  private _overscanRows: number;
  private _minRows: number;
  private _topSpacer: HTMLElement | null = null;
  private _bottomSpacer: HTMLElement | null = null;
  private _lastRange = { start: -1, end: -1 };
  private _lastNonEmptyItems: Contents.IModel[] = [];
  private _lastRenderedRangeStart = 0;
  private _lastRenderedVisibleCount = 0;
  private _updateRaf = 0;
}
