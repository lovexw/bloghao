/* 博客号官网交互：滚动入场 + 导航阴影 + 年份 */
(function () {
  'use strict'

  // 导航滚动态
  var nav = document.getElementById('nav')
  var onScroll = function () {
    nav.classList.toggle('is-scrolled', window.scrollY > 8)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // 滚动入场
  var els = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
    els.forEach(function (el) {
      io.observe(el)
    })
  } else {
    els.forEach(function (el) {
      el.classList.add('is-in')
    })
  }

  // 年份
  var y = document.getElementById('year')
  if (y) y.textContent = String(new Date().getFullYear())
})()
