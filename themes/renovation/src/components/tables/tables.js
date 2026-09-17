(function ($, Drupal) {
  'use strict';

  Drupal.behaviors.fixedTables = {
    attach: function (context) {
      /**
       * IMPORTANT!
       * Do not delete this function, even if we dont have this code in UDS.
       * This is a workaround to add the required elements for the UDS tables,
       * which are not added by the ckeditor plugin.
       */
      function addFixedWrappers() {
        $('.uds-table-fixed').each(function (index) {
          // Idempotency: never wrap a table that is already wrapped.
          if ($(this).closest('.uds-table-fixed-wrapper').length) {
            return;
          }

          // Stable id so the scroll buttons can reference the scrollable region.
          var tableId = 'uds-table-fixed-' + index;
          this.setAttribute('id', tableId);

          var wrapper = document.createElement('div');
          $(wrapper).addClass('uds-table-fixed-wrapper');

          // Add buttons prev and next.
          $(this).wrap(wrapper);
          var added_wrapper = $(this).parent();
          $(added_wrapper).prepend(
            '<div class="scroll-control next"><button type="button" class="btn btn-circle btn-circle-alt-gray" aria-controls="' +
              tableId +
              '"><i class="fas fa-chevron-right" aria-hidden="true"></i><span class="visually-hidden">Next</span></button></div>',
          );
          $(added_wrapper).prepend(
            '<div class="scroll-control previous"><button type="button" class="btn btn-circle btn-circle-alt-gray" aria-controls="' +
              tableId +
              '"><i class="fas fa-chevron-left" aria-hidden="true"></i><span class="visually-hidden">Previous</span></button></div>',
          );
        });
      }

      /**
       * Javascript for fixed table functionality. Fixed table should display scroll buttons when hovering over scrollable portion of table,
       * and hide them when hovering over fixed column or when mouse exits table.
       *
       * The scroll buttons must be outside the table container, within the table wrapper, due to the absolute positioning requirements.
       * Because the table scrolls, if they were to be absolutely positioned in the same container as the table, they would scroll with it.
       */
      window.addEventListener('DOMContentLoaded', function () {
        addFixedWrappers();
        initializeFixedTable();
      });

      function debounce(func, timeout) {
        var timerId;
        return function () {
          var args = arguments;
          clearTimeout(timerId);
          timerId = setTimeout(function () {
            func.apply(null, args);
          }, timeout);
        };
      }

      // Toggle native disabled state on the scroll buttons at scroll boundaries.
      function updateScrollButtons(container, prevBtn, nextBtn) {
        var maxScroll = container.scrollWidth - container.clientWidth;
        prevBtn.disabled = container.scrollLeft <= 0;
        // 1px tolerance absorbs sub-pixel rounding at the right edge.
        nextBtn.disabled = container.scrollLeft >= maxScroll - 1;
      }

      function initializeFixedTable() {
        var wrappers = document.querySelectorAll('.uds-table-fixed-wrapper');

        wrappers.forEach(function (wrapper) {
          var container = wrapper.querySelector('.uds-table-fixed');
          var previous = wrapper.querySelector('.scroll-control.previous');
          var next = wrapper.querySelector('.scroll-control.next');

          if (!container || !previous || !next) {
            return;
          }

          var prevBtn = previous.querySelector('button');
          var nextBtn = next.querySelector('button');

          if (!prevBtn || !nextBtn) {
            return;
          }

          // If the user leaves the scrollable area, hide the scroll controls.
          wrapper.addEventListener('mouseleave', function () {
            previous.classList.remove('show');
            next.classList.remove('show');
          });

          // Scroll on click and on focus. Bound to the real <button> so both
          // pointer and keyboard users can scroll; a disabled boundary button
          // emits neither event, so no extra guard is needed.
          ['click', 'focus'].forEach(function (event) {
            prevBtn.addEventListener(event, function () {
              container.scrollLeft -= 100;
            });
            nextBtn.addEventListener(event, function () {
              container.scrollLeft += 100;
            });
          });

          // Keep the disabled states in sync with the scroll position.
          var update = function () {
            updateScrollButtons(container, prevBtn, nextBtn);
          };
          update();
          container.addEventListener('scroll', debounce(update, 50));
          window.addEventListener('resize', debounce(update, 100));
        });
      }
    },
  };
})(jQuery, Drupal);
