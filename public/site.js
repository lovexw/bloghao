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

  /* ---------------- 上传前图片压缩（前台发布器，与后台同参数） ----------------
   * JPEG/PNG/WebP 超过 300KB 或最长边超 2000px 时压成 JPEG（质量 0.82）；
   * PNG 含透明保持 PNG 只缩尺寸；GIF 动图会压丢帧，原样直传；失败回退原文件。 */
  var IMG_COMPRESS = { MAX_DIM: 2000, MIN_BYTES: 300 * 1024, QUALITY: 0.82 }

  function hasAlphaSampled(bmp) {
    var cv = document.createElement('canvas')
    cv.width = cv.height = 1
    var ctx = cv.getContext('2d')
    ctx.drawImage(bmp, 0, 0, 1, 1)
    var d = ctx.getImageData(0, 0, 1, 1).data
    return d[3] < 250
  }

  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= IMG_COMPRESS.MIN_BYTES) return resolve(file)
      createImageBitmap(file)
        .then(function (bmp) {
          var scale = Math.min(1, IMG_COMPRESS.MAX_DIM / Math.max(bmp.width, bmp.height))
          var toJpeg = file.type !== 'image/png' || !hasAlphaSampled(bmp)
          if (scale >= 1 && !toJpeg) return resolve(file)
          var w = Math.max(1, Math.round(bmp.width * scale))
          var h = Math.max(1, Math.round(bmp.height * scale))
          var cv = document.createElement('canvas')
          cv.width = w
          cv.height = h
          cv.getContext('2d').drawImage(bmp, 0, 0, w, h)
          cv.toBlob(function (blob) {
            bmp.close && bmp.close()
            if (!blob || blob.size >= file.size) return resolve(file)
            var name = (file.name || 'image').replace(/\.[^.]+$/, '') + (toJpeg ? '.jpg' : '.png')
            resolve(new File([blob], name, { type: toJpeg ? 'image/jpeg' : 'image/png' }))
          }, toJpeg ? 'image/jpeg' : 'image/png', IMG_COMPRESS.QUALITY)
        })
        .catch(function () {
          resolve(file)
        })
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

  /* ---------------- 顶部导航「分类话题」折叠菜单：点外部 / Esc 收起 ---------------- */
  function closeNavMenus(except) {
    var open = document.querySelectorAll('details.snav-dd[open]')
    for (var i = 0; i < open.length; i++) {
      if (!except || !open[i].contains(except)) open[i].removeAttribute('open')
    }
  }
  document.addEventListener('click', function (e) {
    closeNavMenus(e.target)
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNavMenus(null)
  })

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
      // 管理员表单没有昵称输入（服务端直接取作者身份），访客留言必须填昵称
      if (nicknameInput && !replyId && !nicknameInput.value.trim()) return
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

  /* ---------------- 留言板（/guestbook：访客留言 + 作者回复，结构与文章留言一致） ---------------- */
  var gbForm = document.getElementById('guestbook-form')
  if (gbForm) {
    var gbTip = gbForm.querySelector('.cmt-tip')
    var gbTipDefault = gbTip ? gbTip.textContent : ''
    var gbParentInput = gbForm.querySelector('[name=parentId]')
    var gbNickname = gbForm.querySelector('[name=nickname]')

    function gbSetReply(id, name) {
      gbForm.dataset.replyId = id ? String(id) : ''
      if (gbParentInput) gbParentInput.value = id ? String(id) : ''
      if (gbNickname) gbNickname.required = !id
      if (!gbTip) return
      if (!id) {
        gbTip.textContent = gbTipDefault
        return
      }
      gbTip.innerHTML = '回复 @' + esc(name) + ' <button type="button" class="cmt-reply-cancel">取消</button>'
      var cancel = gbTip.querySelector('.cmt-reply-cancel')
      if (cancel)
        cancel.addEventListener('click', function () {
          gbSetReply(0, '')
        })
      gbForm.scrollIntoView({ behavior: 'smooth', block: 'center' })
      var ta = gbForm.querySelector('[name=content]')
      if (ta) ta.focus()
    }

    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.cmt-reply-btn') : null
      if (!btn || !document.getElementById('guestbook').contains(btn)) return
      e.preventDefault()
      gbSetReply(Number(btn.getAttribute('data-reply')), btn.getAttribute('data-name') || '')
    })

    gbForm.addEventListener('submit', function (e) {
      e.preventDefault()
      var btn = gbForm.querySelector('.cmt-submit')
      var content = gbForm.querySelector('[name=content]')
      var link = gbForm.querySelector('[name=link]')
      if (!content.value.trim()) return
      // 管理员表单没有昵称输入（服务端直接取作者身份），访客留言必须填昵称
      if (gbNickname && !gbForm.dataset.replyId && !gbNickname.value.trim()) return
      var label = btn.textContent
      btn.textContent = '发送中…'
      btn.disabled = true
      postJSON('/api/public/guestbook', {
        nickname: gbNickname ? gbNickname.value.trim() : '',
        content: content.value.trim(),
        link: link ? link.value : '',
        parentId: gbForm.dataset.replyId ? Number(gbForm.dataset.replyId) : undefined,
      })
        .then(function (d) {
          if (d && d.pending) {
            if (gbTip) gbTip.textContent = '已提交，审核通过后展示'
            content.value = ''
            gbSetReply(0, '')
            btn.textContent = label
            btn.disabled = false
          } else {
            if (gbTip) gbTip.textContent = '留言成功，感谢参与 🙂'
            setTimeout(function () {
              location.reload()
            }, 600)
          }
        })
        .catch(function (err) {
          if (gbTip) gbTip.textContent = err.message || '发送失败，请重试'
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
    // 管理员表单没有昵称输入（服务端直接取作者身份），访客必须填
    if (nickname && !form.dataset.replyId && !nickname.value.trim()) return
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

  /* ---------------- 前台发微博（管理员登录时微博页顶部的发布框，能力与后台发布器一致） ---------------- */
  var composerForm = document.querySelector('[data-wb-composer]')
  if (composerForm) {
    var WB_MAX_IMAGES = 9
    var WB_MAX_CHARS = 5000
    var cpText = composerForm.querySelector('.wb-composer-textarea')
    var cpTiles = composerForm.querySelector('.wb-composer-tiles')
    var cpAdd = composerForm.querySelector('.wb-composer-add')
    var cpCount = composerForm.querySelector('.wb-composer-count')
    var cpTip = composerForm.querySelector('.wb-composer-tip')
    var cpButtons = composerForm.querySelectorAll('.wb-composer-add, .wb-composer-draft, .wb-composer-publish')
    var cpImages = []
    var cpTipTimer = null

    function cpMsg(msg) {
      if (!cpTip) return
      cpTip.textContent = msg || ''
      if (cpTipTimer) clearTimeout(cpTipTimer)
      if (msg) cpTipTimer = setTimeout(function () { cpTip.textContent = '' }, 4000)
    }

    function cpRender() {
      if (cpTiles) {
        cpTiles.hidden = !cpImages.length
        cpTiles.innerHTML = cpImages
          .map(function (u, i) {
            return (
              '<span class="wb-composer-tile"><img src="' + esc(u) + '" alt="">'+
              '<button type="button" class="wb-composer-tile-del" data-i="' + i + '" title="移除">×</button></span>'
            )
          })
          .join('')
      }
      if (cpAdd) cpAdd.textContent = '加图（' + cpImages.length + '/' + WB_MAX_IMAGES + '）'
      if (cpCount && cpText) cpCount.textContent = cpText.value.length + ' / ' + WB_MAX_CHARS
    }

    if (cpTiles) {
      cpTiles.addEventListener('click', function (e) {
        var del = e.target && e.target.closest ? e.target.closest('.wb-composer-tile-del') : null
        if (!del) return
        cpImages.splice(Number(del.getAttribute('data-i')), 1)
        cpRender()
      })
    }
    if (cpText) cpText.addEventListener('input', cpRender)

    function cpUpload(file) {
      var fd = new FormData()
      fd.append('file', file)
      return fetch('/api/admin/upload', { method: 'POST', body: fd }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || '上传失败')
          return d.url
        })
      })
    }

    // 上传前压缩（compressImage 定义在文件顶部工具区）
    function cpUploadCompressed(file) {
      return compressImage(file).then(function (out) {
        return cpUpload(out)
      })
    }

    function cpAddFiles(fileList) {
      var all = Array.prototype.slice.call(fileList || [])
      var imgs = all.filter(function (f) { return /^image\//.test(f.type) })
      if (!imgs.length) {
        if (all.length) cpMsg('只支持 JPG / PNG / WebP / GIF 图片')
        return
      }
      var room = WB_MAX_IMAGES - cpImages.length
      if (room <= 0) {
        cpMsg('最多 ' + WB_MAX_IMAGES + ' 张图')
        return
      }
      if (imgs.length > room) cpMsg('最多 ' + WB_MAX_IMAGES + ' 张图，多出的已忽略')
      var label = cpAdd ? cpAdd.textContent : ''
      if (cpAdd) cpAdd.disabled = true
      var chain = Promise.resolve()
      imgs.slice(0, room).forEach(function (f) {
        chain = chain.then(function () {
          if (cpAdd) cpAdd.textContent = '上传中 ' + f.name.slice(0, 12) + '…'
          return cpUploadCompressed(f).then(function (url) {
            cpImages.push(url)
            cpRender()
          })
        })
      })
      chain
        .catch(function (err) {
          cpMsg((err && err.message) || '上传失败')
        })
        .finally(function () {
          if (cpAdd) {
            cpAdd.disabled = false
            cpAdd.textContent = label
          }
          cpRender()
        })
    }

    if (cpAdd) {
      cpAdd.addEventListener('click', function () {
        var input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/jpeg,image/png,image/webp,image/gif'
        input.multiple = true
        input.onchange = function () { cpAddFiles(input.files) }
        input.click()
      })
    }

    // 粘贴图片：光标在发布框内 ⌘/Ctrl+V 即上传（纯文本粘贴不受影响）
    composerForm.addEventListener('paste', function (e) {
      var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || [])
      if (!files.length) return
      e.preventDefault()
      cpAddFiles(files)
    })
    // 拖拽图片到发布框（拖文本进输入框仍是默认行为）
    composerForm.addEventListener('dragover', function (e) {
      var types = e.dataTransfer && e.dataTransfer.types
      if (!types || !Array.prototype.includes.call(types, 'Files')) return
      e.preventDefault()
      composerForm.classList.add('is-dragover')
    })
    composerForm.addEventListener('dragleave', function () {
      composerForm.classList.remove('is-dragover')
    })
    composerForm.addEventListener('drop', function (e) {
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || [])
      if (!files.length) return
      e.preventDefault()
      composerForm.classList.remove('is-dragover')
      cpAddFiles(files)
    })

    function cpPublish(status) {
      var content = cpText ? cpText.value.trim() : ''
      if (!content && !cpImages.length) {
        cpMsg('写点什么，或者配张图吧')
        return
      }
      cpButtons.forEach(function (b) { b.disabled = true })
      postJSON('/api/admin/weibo', { content: content, images: cpImages, status: status })
        .then(function () {
          if (status === 'published') {
            location.reload()
            return
          }
          if (cpText) cpText.value = ''
          cpImages = []
          cpRender()
          cpMsg('草稿已保存，到后台「微博」页可继续编辑')
        })
        .catch(function (err) {
          cpMsg((err && err.message) || '发布失败，请重试')
        })
        .finally(function () {
          cpButtons.forEach(function (b) { b.disabled = false })
        })
    }
    var cpPub = composerForm.querySelector('.wb-composer-publish')
    var cpDraft = composerForm.querySelector('.wb-composer-draft')
    if (cpPub) cpPub.addEventListener('click', function () { cpPublish('published') })
    if (cpDraft) cpDraft.addEventListener('click', function () { cpPublish('draft') })
    cpRender()
  }

  /* ---------------- 友链申请收录（/links 页表单） ---------------- */
  document.addEventListener('submit', function (e) {
    var form = e.target
    if (!form || !form.classList || !form.classList.contains('fl-form')) return
    e.preventDefault()
    var name = form.querySelector('[name=name]')
    var url = form.querySelector('[name=url]')
    var desc = form.querySelector('[name=description]')
    var link = form.querySelector('[name=link]')
    var tip = form.querySelector('.fl-tip')
    var btn = form.querySelector('.fl-submit')
    if (!name.value.trim() || !url.value.trim()) return
    var label = btn.textContent
    btn.textContent = '提交中…'
    btn.disabled = true
    postJSON('/api/public/links/apply', {
      name: name.value.trim(),
      url: url.value.trim(),
      description: desc ? desc.value.trim() : '',
      link: link ? link.value : '',
    })
      .then(function () {
        name.value = ''
        url.value = ''
        if (desc) desc.value = ''
        if (tip) tip.textContent = '已提交，站长审核通过后就会展示在这里 🎉'
      })
      .catch(function (err) {
        if (tip) tip.textContent = (err && err.message) || '提交失败，请重试'
      })
      .finally(function () {
        btn.textContent = label
        btn.disabled = false
      })
  })

  /* ---------------- 图片灯箱：正文图 + 微博配图，点击全屏查看 ----------------
   * 手势：单指/滚轮缩放（双指捏合）、拖动平移、双击放大复原、左右滑动切换同组图片。
   * 纯 JS + 内联 style（CSP style-src 允许内联），无外部依赖。 */
  ;(function () {
    var lb = null
    var imgEl = null
    var group = [] // 同组图片 URL
    var idx = 0
    var scale = 1
    var tx = 0
    var ty = 0
    var pinchDist = 0
    var pointers = new Map()
    var lastTap = 0

    function apply() {
      imgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'
    }
    function reset() {
      scale = 1
      tx = 0
      ty = 0
      apply()
    }
    function show(i) {
      idx = (i + group.length) % group.length
      imgEl.src = group[idx]
      reset()
    }
    function close() {
      if (!lb) return
      document.removeEventListener('keydown', onKey, true)
      lb.remove()
      lb = null
      imgEl = null
      group = []
      document.body.style.overflow = ''
    }
    function onKey(e) {
      if (!lb) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' && group.length > 1) show(idx + 1)
      else if (e.key === 'ArrowLeft' && group.length > 1) show(idx - 1)
      else return
      e.preventDefault()
    }
    function open(target) {
      // 同组：同一容器里的所有内容图（文章正文 / 微博九图），按 DOM 顺序
      var holder = target.closest('.rich, .wb-imgs, .wb-card') || document.body
      var imgs = [].slice.call(holder.querySelectorAll('img')).filter(function (im) {
        return (im.currentSrc || im.src) && !im.closest('a')
      })
      group = imgs.map(function (im) {
        return im.currentSrc || im.src
      })
      idx = Math.max(0, imgs.indexOf(target))
      if (!group.length) return

      lb = document.createElement('div')
      lb.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:zoom-out;'
      )
      var counter = document.createElement('div')
      counter.setAttribute(
        'style',
        'position:absolute;top:calc(12px + env(safe-area-inset-top));left:0;right:0;text-align:center;color:#fff;font-size:13px;opacity:.7;pointer-events:none;font-family:-apple-system,sans-serif;'
      )
      var btnClose = document.createElement('div')
      btnClose.setAttribute(
        'style',
        'position:absolute;top:calc(6px + env(safe-area-inset-top));right:10px;width:40px;height:40px;line-height:38px;text-align:center;color:#fff;font-size:26px;cursor:pointer;font-family:-apple-system,sans-serif;'
      )
      btnClose.textContent = '×'
      btnClose.addEventListener('click', close)
      imgEl = document.createElement('img')
      imgEl.setAttribute('style', 'max-width:92vw;max-height:88vh;transition:transform .18s ease;will-change:transform;user-select:none;-webkit-user-drag:none;')
      lb.appendChild(imgEl)
      lb.appendChild(counter)
      lb.appendChild(btnClose)
      document.body.appendChild(lb)
      document.body.style.overflow = 'hidden'
      counter.textContent = group.length > 1 ? (idx + 1) + ' / ' + group.length : ''
      document.addEventListener('keydown', onKey, true)

      // 指针事件统一处理鼠标拖动 / 触摸 / 双指捏合
      lb.addEventListener('pointerdown', function (e) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size === 2) {
          var ps = [].slice.call(pointers.values())
          pinchDist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
        }
        // 双击（300ms 内两次 tap）放大 1↔2.5
        var now = Date.now()
        if (now - lastTap < 300 && pointers.size === 1) {
          scale = scale > 1.4 ? 1 : 2.5
          if (scale === 1) {
            tx = 0
            ty = 0
          }
          apply()
        }
        lastTap = now
        imgEl.style.transition = 'none'
      })
      lb.addEventListener('pointermove', function (e) {
        if (!pointers.has(e.pointerId)) return
        var prev = pointers.get(e.pointerId)
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size === 2) {
          var ps = [].slice.call(pointers.values())
          var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
          if (pinchDist > 0) {
            scale = Math.min(6, Math.max(1, scale * (d / pinchDist)))
            apply()
          }
          pinchDist = d
          return
        }
        if (scale > 1) {
          tx += e.clientX - prev.x
          ty += e.clientY - prev.y
          apply()
          return
        }
        // 未放大时横向拖超过 60px 即切图（touch 上跟手，抬手判定）
        var dx = e.clientX - pointers.get(e.pointerId).x + (e.clientX - prev.x)
        if (group.length > 1 && Math.abs(dx) > 0) imgEl.style.transform = 'translateX(' + dx / 3 + 'px)'
      })
      var startPos = null
      lb.addEventListener('pointerdown', function (e) {
        if (pointers.size === 1) startPos = { x: e.clientX, y: e.clientY, t: Date.now() }
      })
      lb.addEventListener('pointerup', function (e) {
        var wasPinch = pointers.size >= 2
        pointers.delete(e.pointerId)
        pinchDist = 0
        imgEl.style.transition = 'transform .18s ease'
        if (wasPinch) return
        if (startPos && scale === 1) {
          var dx = e.clientX - startPos.x
          var dy = e.clientY - startPos.y
          var dt = Date.now() - startPos.t
          if (group.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && dt < 600) {
            show(idx + (dx < 0 ? 1 : -1))
            counter.textContent = (idx + 1) + ' / ' + group.length
            startPos = null
            return
          }
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.target === lb) {
            close()
            startPos = null
            return
          }
        }
        startPos = null
        reset()
      })
      lb.addEventListener('pointercancel', function (e) {
        pointers.delete(e.pointerId)
        pinchDist = 0
        reset()
      })
      // 桌面滚轮缩放
      lb.addEventListener(
        'wheel',
        function (e) {
          e.preventDefault()
          scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87)))
          if (scale === 1) {
            tx = 0
            ty = 0
          }
          apply()
        },
        { passive: false }
      )

      show(idx)
    }

    // 委托点击：正文图与微博配图进入灯箱（编辑器里 data-og-image 的 meta 不含 img，不受影响）
    document.addEventListener('click', function (e) {
      var t = e.target
      if (!t || t.tagName !== 'IMG') return
      // 排除头像、图标等小图（<100px）与已带链接的图
      var r = t.getBoundingClientRect()
      if (r.width && r.width < 100) return
      if (t.closest('a')) return
      if (!t.closest('.rich, .wb-imgs')) return
      e.preventDefault()
      open(t)
    })
  })()
})()
