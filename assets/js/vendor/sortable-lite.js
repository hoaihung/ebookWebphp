// Tiny Sortable library to enable drag‑and‑drop reordering of table rows.
// This module has no external dependencies. It attaches drag handlers to a
// table body and reorders rows on drop. A callback may be provided to
// receive the new order.
export function makeSortable(tbody, { handleSelector = '.drag-handle', onUpdate } = {}) {
    let dragRow = null;

    /**
     * Start dragging only when the user grabs the handle. We add a
     * `dragging` class to the row for visual feedback and specify a
     * minimal drag image to hide the default ghost. The row itself
     * will be repositioned on dragover events, so no placeholder is
     * necessary.
     */
    function onDragStart(e) {
        const handle = e.target.closest(handleSelector);
        const row = e.target.closest('tr');
        if (!handle || !row) {
            e.preventDefault();
            return;
        }
        dragRow = row;
        row.classList.add('dragging');
        // Assign a minimal data payload for cross‑browser support. Some
        // browsers will not initiate a drag operation unless data is set.
        // We use a simple string as the payload. Without this call,
        // drop events may never fire and the row will not move.
        e.dataTransfer.setData('text/plain', 'drag');
        e.dataTransfer.effectAllowed = 'move';
        // Hide the default drag ghost by using a 1x1 transparent GIF. This
        // causes the actual row in the DOM to appear to move instead of
        // leaving behind the default semi‑opaque image.
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        e.dataTransfer.setDragImage(img, 0, 0);
    }

    /**
     * During drag, insert the dragged row before or after the row
     * currently hovered. This gives the impression that the row is
     * moving with the cursor and avoids the need for a placeholder.
     */
    function onDragOver(e) {
        if (!dragRow) return;
        e.preventDefault();
        const row = e.target.closest('tr');
        if (!row || row === dragRow) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        if (before) {
            tbody.insertBefore(dragRow, row);
        } else {
            tbody.insertBefore(dragRow, row.nextSibling);
        }
    }

    /**
     * When dropped, simply call onUpdate with the new order of rows. The
     * row has already been moved into its final position via onDragOver.
     */
    function onDrop(e) {
        if (!dragRow) return;
        e.preventDefault();
        if (onUpdate) onUpdate(Array.from(tbody.querySelectorAll('tr')));
        cleanup();
    }

    /**
     * Clean up state after drag operation. Remove the dragging class and
     * reset the global reference.
     */
    function cleanup() {
        if (dragRow) dragRow.classList.remove('dragging');
        dragRow = null;
    }

    tbody.addEventListener('dragstart', onDragStart);
    tbody.addEventListener('dragover', onDragOver);
    tbody.addEventListener('drop', onDrop);
    tbody.addEventListener('dragend', cleanup);
}