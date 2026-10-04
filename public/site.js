/* 博客号前台交互：点赞 + 留言（含作者回复）+ 微博折叠评论（所有主题共用，保持极小体积） */
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

  function getJSON(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || '请求失败')
        return d
      })
    })
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    })
  }

  // 与后端 weiboTime 保持一致：今年「10月3日 14:20」，往年带年份
  function fmtTime(ts) {
    var d = new Date(Number(ts))
    if (isNaN(d.getTime())) return ''
    function p(x) {
      return ('0' + x).slice(-2)
    }
    var hm = p(d.getHours()) + ':' + p(d.getMinutes())
    var now = new Date()
    if (d.getFullYear() === now.getFullYear()) return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + hm
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
  }

  /* ---------------- 点赞（文章 + 微博，localStorage 防重复，可再点取消） ---------------- */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.like-btn') : null
    if (!btn) return
    e.preventDefault()
    var isWeibo = btn.getAttribute('data-type') === 'weibo'
    var targetId = isWeibo ? btn.getAttribute('data-id') : btn.getAttribute('data-slug')
    if (!targetId || btn.dataset.busy) return
    var key = 'bloghao-liked-' + (isWeibo ? 'wb-' + targetId : targetId)
    var url = isWeibo
      ? '/api/public/like/weibo/' + encodeURIComponent(targetId)
      : '/api/public/like/' + encodeURIComponent(targetId)
    var liked = localStorage.getItem(key) === '1'
    btn.dataset.busy = '1'
    postJSON(url, { delta: liked ? -1 : 1 })
      .then(function (d) {
        localStorage.setItem(key, liked ? '0' : '1')
        btn.classList.toggle('liked', !liked)
        var count = btn.querySelector('[data-count]')
        if (count && typeof d.likes === 'number') count.textContent = String(d.likes)
      })
      .catch(function () {})
      .finally(function () {
        delete btn.dataset.busy
      })
  })

  /* ---------------- 文章留言（管理员可回复：楼中楼） ---------------- */
  var form = document.getElementById('comment-form')
  if (form) {
    var tipEl = form.querySelector('.cmt-tip')
    var tipDefault = tipEl ? tipEl.textContent : ''
    var parentIdInput = form.querySelector('[name=parentId]')
    var nicknameInput = form.querySelector('[name=nickname]')
    var replyId = 0

    function setReply(id, name) {
      replyId = id || 0
      if (parentIdInput) parentIdInput.value = replyId ? String(replyId) : ''
      if (nicknameInput) nicknameInput.required = !replyId
      if (!tipEl) return
      if (!replyId) {
        tipEl.textContent = tipDefault
        return
      }
      tipEl.innerHTML =
        '回复 @' + esc(name) + ' <button type="button" class="cmt-reply-cancel">取消</button>'
      var cancel = tipEl.querySelector('.cmt-reply-cancel')
      if (cancel)
        cancel.addEventListener('click', function () {
          setReply(0, '')
        })
      form.scrollIntoView({ behavior: 'smooth', block: 'center' })
      var ta = form.querySelector('[name=content]')
      if (ta) ta.focus()
    }

    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.cmt-reply-btn') : null
      if (!btn) return
      e.preventDefault()
      setReply(Number(btn.getAttribute('data-reply')), btn.getAttribute('data-name') || '')
    })

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var btn = form.querySelector('.cmt-submit')
      var content = form.querySelector('[name=content]')
      var link = form.querySelector('[name=link]')
      if (!content.value.trim()) return
      // 管理员回复不带昵称（服务端用作者身份），访客留言必须填昵称
      if (!replyId && (!nicknameInput || !nicknameInput.value.trim())) return
      var label = btn.textContent
      btn.textContent = '发送中…'
      btn.disabled = true
      postJSON('/api/public/comments', {
        slug: form.getAttribute('data-slug'),
        nickname: nicknameInput ? nicknameInput.value.trim() : '',
        content: content.value.trim(),
        link: link ? link.value : '',
        parentId: replyId || undefined,
      })
        .then(function (d) {
          if (d && d.pending) {
            if (tipEl) tipEl.textContent = '已提交，审核通过后展示'
            content.value = ''
            setReply(0, '')
            btn.textContent = label
            btn.disabled = false
          } else {
            if (tipEl) tipEl.textContent = '留言成功，感谢参与 🙂'
            setTimeout(function () {
              location.reload()
            }, 600)
          }
        })
        .catch(function (err) {
          if (tipEl) tipEl.textContent = err.message || '发送失败，请重试'
          btn.textContent = label
          btn.disabled = false
        })
    })
  }

  /* ---------------- 微博卡片：折叠评论区 ---------------- */
  var authPromise = null
  function authState() {
    if (!authPromise) authPromise = getJSON('/api/auth/state').catch(function () { return { user: null } })
    return authPromise
  }

  // 平铺评论 → 楼中楼（父评论被删的回复按顶层展示）
  function renderWeiboComments(panel, comments, isAdmin) {
    var listEl = panel.querySelector('[data-role=list]')
    if (!listEl) return
    var byParent = {}
    var ids = {}
    comments.forEach(function (c) {
      ids[c.id] = true
    })
    var tops = []
    comments.forEach(function (c) {
      if (!c.parent_id || !ids[c.parent_id]) tops.push(c)
      else (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c)
    })
    if (!comments.length) {
      listEl.innerHTML = '<p class="wb-cmt-empty">还没有评论，来抢沙发～</p>'
      return
    }
    function item(c, nested) {
      var html =
        '<li class="wb-cmt-item' + (nested ? ' wb-cmt-nested' : '') + '" id="wbc-' + c.id + '">' +
        '<div class="wb-cmt-head"><span class="wb-cmt-name">' + esc(c.nickname) +
        (Number(c.is_admin) ? '<span class="wb-cmt-badge">作者</span>' : '') +
        '</span><span class="wb-cmt-time">' + fmtTime(c.created_at) + '</span>' +
        (isAdmin
          ? '<button type="button" class="wb-cmt-reply-btn" data-reply="' + c.id + '" data-name="' + esc(c.nickname) + '">回复</button>'
          : '') +
        '</div><div class="wb-cmt-body">' + esc(c.content) + '</div>'
      var kids = byParent[c.id] || []
      if (kids.length) html += '<ul class="wb-cmt-children">' + kids.map(function (k) { return item(k, true) }).join('') + '</ul>'
      return html + '</li>'
    }
    listEl.innerHTML = '<ul class="wb-cmt-list">' + tops.map(function (c) { return item(c, false) }).join('') + '</ul>'
  }

  function loadWeiboComments(panel) {
    var listEl = panel.querySelector('[data-role=list]')
    var wbId = panel.getAttribute('data-wb-cmt')
    if (!listEl || !wbId) return
    listEl.innerHTML = '<p class="wb-cmt-loading">加载中…</p>'
    Promise.all([getJSON('/api/public/weibo/' + encodeURIComponent(wbId) + '/comments'), authState()])
      .then(function (rs) {
        renderWeiboComments(panel, (rs[0] && rs[0].comments) || [], !!(rs[1] && rs[1].user))
      })
      .catch(function () {
        listEl.innerHTML = '<p class="wb-cmt-empty">评论加载失败，稍后再试</p>'
      })
  }

  // 展开 / 收起（首次展开时拉取评论）
  document.addEventListener('click', function (e) {
    var toggle = e.target && e.target.closest ? e.target.closest('.wb-cmt-toggle') : null
    if (!toggle) return
    e.preventDefault()
    var card = toggle.closest('.wb-card')
    var panel = card && card.querySelector('.wb-cmt')
    if (!panel) return
    var willShow = panel.hidden
    panel.hidden = !willShow
    toggle.setAttribute('aria-expanded', willShow ? 'true' : 'false')
    if (willShow && !panel.dataset.loaded) {
      panel.dataset.loaded = '1'
      loadWeiboComments(panel)
    }
  })

  // 卡片内评论的「回复」（仅管理员可见的按钮由 JS 渲染）
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.wb-cmt-reply-btn') : null
    if (!btn) return
    e.preventDefault()
    var panel = btn.closest('.wb-cmt')
    var form = panel && panel.querySelector('[data-role=form]')
    if (!form) return
    form.dataset.replyId = btn.getAttribute('data-reply') || ''
    var nickname = form.querySelector('[name=nickname]')
    if (nickname) nickname.required = false
    var tip = form.querySelector('.wb-cmt-tip')
    if (tip) {
      tip.innerHTML =
        '回复 @' + esc(btn.getAttribute('data-name')) + ' <button type="button" class="wb-cmt-reply-cancel">取消</button>'
      var cancel = tip.querySelector('.wb-cmt-reply-cancel')
      if (cancel)
        cancel.addEventListener('click', function () {
          form.dataset.replyId = ''
          if (nickname) nickname.required = true
          tip.textContent = ''
        })
    }
    var ta = form.querySelector('[name=content]')
    if (ta) ta.focus()
  })

  // 卡片内评论提交（访客留言 / 管理员回复共用一个表单）
  document.addEventListener('submit', function (e) {
    var form = e.target
    if (!form || !form.classList || !form.classList.contains('wb-cmt-form')) return
    e.preventDefault()
    var panel = form.closest('.wb-cmt')
    var card = form.closest('.wb-card')
    var toggle = card && card.querySelector('.wb-cmt-toggle')
    var wbId = panel && panel.getAttribute('data-wb-cmt')
    if (!wbId) return
    var content = form.querySelector('[name=content]')
    var nickname = form.querySelector('[name=nickname]')
    var link = form.querySelector('[name=link]')
    var tip = form.querySelector('.wb-cmt-tip')
    var btn = form.querySelector('.wb-cmt-submit')
    if (!content || !content.value.trim()) return
    // 管理员回复不带昵称，访客必须填
    if (!form.dataset.replyId && (!nickname || !nickname.value.trim())) return
    var label = btn ? btn.textContent : ''
    if (btn) {
      btn.textContent = '发送中…'
      btn.disabled = true
    }
    postJSON('/api/public/weibo/' + encodeURIComponent(wbId) + '/comments', {
      nickname: nickname ? nickname.value.trim() : '',
      content: content.value.trim(),
      link: link ? link.value : '',
      parentId: form.dataset.replyId ? Number(form.dataset.replyId) : undefined,
    })
      .then(function (d) {
        if (d && d.pending) {
          if (tip) tip.textContent = '已提交，审核通过后展示'
          content.value = ''
        } else {
          content.value = ''
          form.dataset.replyId = ''
          if (tip) tip.textContent = ''
          if (nickname) nickname.required = true
          loadWeiboComments(panel)
          var count = toggle && toggle.querySelector('[data-count]')
          if (count) count.textContent = String((parseInt(count.textContent, 10) || 0) + 1)
        }
      })
      .catch(function (err) {
        if (tip) tip.textContent = (err && err.message) || '发送失败，请重试'
      })
      .finally(function () {
        if (btn) {
          btn.textContent = label
          btn.disabled = false
        }
      })
  })
})()
