/* 墨博前台交互：点赞 + 留言表单（所有主题共用，保持极小体积） */
(function () {
  'use strict'

  function postJSON(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || '请求失败')
        return d
      })
    })
  }

  // 点赞（localStorage 防重复，可再点取消）
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.like-btn') : null
    if (!btn) return
    e.preventDefault()
    var slug = btn.getAttribute('data-slug')
    if (!slug || btn.dataset.busy) return
    var liked = localStorage.getItem('moblog-liked-' + slug) === '1'
    btn.dataset.busy = '1'
    postJSON('/api/public/like/' + encodeURIComponent(slug), { delta: liked ? -1 : 1 })
      .then(function (d) {
        localStorage.setItem('moblog-liked-' + slug, liked ? '0' : '1')
        btn.classList.toggle('liked', !liked)
        var count = btn.querySelector('[data-count]')
        if (count && typeof d.likes === 'number') count.textContent = String(d.likes)
      })
      .catch(function () {})
      .finally(function () {
        delete btn.dataset.busy
      })
  })

  // 留言
  var form = document.getElementById('comment-form')
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var tip = form.querySelector('.cmt-tip')
      var btn = form.querySelector('.cmt-submit')
      var nickname = form.querySelector('[name=nickname]')
      var content = form.querySelector('[name=content]')
      var link = form.querySelector('[name=link]')
      if (!nickname.value.trim() || !content.value.trim()) return
      var label = btn.textContent
      btn.textContent = '发送中…'
      btn.disabled = true
      postJSON('/api/public/comments', {
        slug: form.getAttribute('data-slug'),
        nickname: nickname.value.trim(),
        content: content.value.trim(),
        link: link ? link.value : '',
      })
        .then(function () {
          if (tip) tip.textContent = '留言成功，感谢参与 🙂'
          content.value = ''
          setTimeout(function () {
            location.reload()
          }, 600)
        })
        .catch(function (err) {
          if (tip) tip.textContent = err.message || '发送失败，请重试'
          btn.textContent = label
          btn.disabled = false
        })
    })
  }
})()
