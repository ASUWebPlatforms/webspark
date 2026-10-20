(function ($, Drupal, once) {
  'use strict';

  Drupal.behaviors.donutChart = {
    attach: function (context) {
      $(once('chartsGraphs', '.uds-charts-and-graphs-container', context)).each(
        function () {
          var $percentage = $(this).attr('data-number');
          var ctx = $(this).find('canvas', context);
          // Chart.js paints on canvas, so the segment color can't come from a
          // stylesheet; read the active palette from the Bootstrap root var.
          var brandColor =
            getComputedStyle(document.documentElement)
              .getPropertyValue('--bs-gold')
              .trim() || '#FFC627';
          const config = {
            type: 'doughnut',
            data: {
              datasets: [
                {
                  data: [$percentage, 100 - $percentage],
                  backgroundColor: [brandColor, '#FAFAFA'],
                },
              ],
            },
            options: {
              cutout: '70%',
              tooltips: { enabled: false },
              events: [],
            },
          };
          var myChart = new Chart(ctx, config);
        },
      );
    },
  };
})(jQuery, Drupal, once);
