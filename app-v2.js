(function () {
  'use strict';

  var SUPABASE_URL = 'https://znrpqissoybeuzivxwbv.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_CYFgu8QRyoLwKKQK0ttIgg_GAOPwY-f';
  var BRAND = 'TB社区';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    document.addEventListener('DOMContentLoaded', function () {
      var status = document.getElementById('db-status');
      if (status) status.textContent = '应用组件加载失败';
    });
    return;
  }

  var db = window.tbCommunityClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  window.tbCommunityClient = db;

  var state = {
    authMode: 'login',
    verified: false,
    session: null,
    profile: null,
    settings: null,
    activePage: 'home',
    activePost: null,
    activePeer: null,
    uploads: [],
    feed: [],
    notifications: [],
    friends: [],
    notificationChannel: null,
    messageChannel: null,
    notificationTimer: 0,
    messageTimer: 0,
    routeToken: 0,
    confirmAction: null
  };

  function byId(id) { return document.getElementById(id); }
  function first(value) { return Array.isArray(value) ? (value[0] || null) : (value || null); }

  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function toast(message) {
    var node = byId('toast');
    if (!node) return;
    node.textContent = String(message || '操作失败');
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    window.clearTimeout(node._timer);
    node._timer = window.setTimeout(function () { node.classList.remove('show'); }, 2800);
  }

  function errorText(error) {
    var message = String(error && error.message ? error.message : error || '请求失败');
    if (/Invalid login credentials/i.test(message)) return '邮箱或密码错误';
    if (/Email not confirmed/i.test(message)) return '请先验证邮箱';
    if (/User already registered/i.test(message)) return '邮箱已注册';
    if (/rate limit|too many/i.test(message)) return '操作太快';
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) return '网络异常';
    if (/permission denied|row-level security|42501/i.test(message)) return '没有权限';
    if (/PGRST202|Could not find the function|schema cache/i.test(message)) return '数据库未升级';
    if (/duplicate key|23505/i.test(message)) return '内容已存在';
    return message.length > 90 ? '请求失败' : message;
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyText || '处理中';
      button.disabled = true;
    } else {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }

  async function rpc(name, args) {
    var result = await db.rpc(name, args || {});
    if (result.error) throw result.error;
    return result.data;
  }

  function empty(container, text) {
    if (!container) return;
    container.replaceChildren();
    var node = document.createElement('div');
    node.className = 'empty';
    node.textContent = text || '暂无内容';
    container.appendChild(node);
  }

  function formatTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function validUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return value;
    try {
      var url = new URL(value, window.location.href);
      return /^(https?:|blob:)$/.test(url.protocol) ? url.href : '';
    } catch (ignore) { return ''; }
  }

  function parseImages(value) {
    if (Array.isArray(value)) return value.map(validUrl).filter(Boolean);
    if (!value) return [];
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(validUrl).filter(Boolean);
    } catch (ignore) {}
    return String(value).split(',').map(function (item) { return validUrl(item.trim()); }).filter(Boolean);
  }

  function imageNode(src, alt) {
    var image = document.createElement('img');
    image.alt = alt || '';
    image.loading = 'lazy';
    image.addEventListener('error', function () { image.remove(); });
    image.src = src;
    return image;
  }

  window.handleImageError = function (image) {
    if (image) image.remove();
  };

  function initials(profile) {
    var value = profile && (profile.nickname || profile.username);
    return String(value || 'TB').trim().slice(0, 2).toUpperCase();
  }

  function setAvatar(target, profile) {
    if (!target) return;
    target.replaceChildren();
    var src = validUrl(profile && profile.avatar);
    if (!src) {
      target.textContent = initials(profile);
      return;
    }
    var image = imageNode(src, '');
    image.addEventListener('error', function () { target.textContent = initials(profile); });
    target.appendChild(image);
  }

  function makeAvatar(profile, className) {
    var avatar = document.createElement('span');
    avatar.className = className || 'avatar';
    setAvatar(avatar, profile);
    return avatar;
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function openDialog(id) {
    var dialog = byId(id);
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }

  function closeDialog(id) {
    var dialog = byId(id);
    if (dialog && dialog.open) dialog.close();
  }

  function confirmAction(title, text, action) {
    byId('confirm-title').textContent = title || '确认';
    byId('confirm-text').textContent = text || '';
    state.confirmAction = action;
    openDialog('confirm-dialog');
  }

  async function compressImage(file, maxSide, quality) {
    if (!file || !/^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('图片格式不支持');
    if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB');
    var data = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
    var image = await new Promise(function (resolve, reject) {
      var node = new Image();
      node.onload = function () { resolve(node); };
      node.onerror = function () { reject(new Error('图片损坏')); };
      node.src = data;
    });
    var limit = maxSide || 1600;
    var scale = Math.min(1, limit / image.width, limit / image.height);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality || .82);
  }

  function resetVerify() {
    state.verified = false;
    var button = byId('human-check');
    button.setAttribute('aria-pressed', 'false');
    byId('human-check-text').textContent = '点击验证';
  }

  function toggleAuthMode() {
    state.authMode = state.authMode === 'login' ? 'register' : 'login';
    var register = state.authMode === 'register';
    byId('register-username-field').classList.toggle('hidden', !register);
    byId('auth-username').required = register;
    byId('auth-password').autocomplete = register ? 'new-password' : 'current-password';
    byId('auth-submit').textContent = register ? '注册' : '登录';
    byId('auth-mode-toggle').textContent = register ? '返回登录' : '注册账号';
    resetVerify();
  }

  async function submitAuth(event) {
    event.preventDefault();
    var email = byId('auth-email').value.trim().toLowerCase();
    var password = byId('auth-password').value;
    var username = byId('auth-username').value.trim();
    var button = byId('auth-submit');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('邮箱格式错误');
    if (password.length < 8) return toast('密码至少 8 位');
    if (!state.verified) return toast('请先点击验证');
    if (state.authMode === 'register' && !/^[A-Za-z0-9_]{3,32}$/.test(username)) return toast('用户名格式错误');
    setBusy(button, true, state.authMode === 'login' ? '登录中' : '注册中');
    try {
      if (state.authMode === 'login') {
        var login = await db.auth.signInWithPassword({ email: email, password: password });
        if (login.error) throw login.error;
        toast('已登录');
        await route();
      } else {
        var signup = await db.auth.signUp({
          email: email,
          password: password,
          options: { data: { username: username } }
        });
        if (signup.error) throw signup.error;
        if (signup.data.session) {
          toast('已注册');
          await route();
        } else {
          toast('请查收验证邮件');
          toggleAuthMode();
        }
      }
    } catch (error) {
      resetVerify();
      toast(errorText(error));
    } finally { setBusy(button, false); }
  }

  function applySettings(settings) {
    settings = settings || {};
    var title = String(settings.site_title || BRAND).trim();
    if (/^小窝(?:QWQ)?$/.test(title)) title = BRAND;
    document.title = title;
    document.querySelectorAll('[data-site-title]').forEach(function (node) { node.textContent = title; });
    var background = validUrl(settings.home_background_url);
    document.documentElement.style.setProperty('--site-background', background ? 'url("' + background.replace(/"/g, '%22') + '")' : 'none');
    var overlay = Number(settings.home_background_overlay);
    var imageOpacity = background ? Math.max(.08, Math.min(.35, 1 - (Number.isFinite(overlay) ? overlay : .35))) : 0;
    document.documentElement.style.setProperty('--site-image-opacity', String(imageOpacity));
    state.settings = Object.assign({}, settings, { site_title: title });
  }

  async function loadPublicSettings() {
    try {
      var settings = first(await rpc('get_public_site_settings_v2')) || {};
      applySettings(settings);
      byId('db-status').textContent = '邮箱由 Supabase Auth 管理';
      return settings;
    } catch (error) {
      applySettings({ site_title: BRAND });
      if (/数据库未升级/.test(errorText(error))) byId('db-status').textContent = '请先执行数据库升级脚本';
      return {};
    }
  }

  function closeSidebar() {
    byId('sidebar').classList.remove('open');
    hide(byId('sidebar-backdrop'));
  }

  function openSidebar() {
    byId('sidebar').classList.add('open');
    show(byId('sidebar-backdrop'));
  }

  function setAccount(profile) {
    var name = profile.nickname || profile.username || '用户';
    byId('account-name').textContent = name;
    byId('account-role').textContent = profile.role === 'admin' ? '管理员' : (profile.role === 'auditor' ? '审核员' : '成员');
    document.querySelectorAll('[data-avatar]').forEach(function (node) { setAvatar(node, profile); });
    var staff = profile.role === 'admin' || profile.role === 'auditor';
    byId('staff-nav').classList.toggle('hidden', !staff);
    var admin = profile.role === 'admin';
    ['admin-users-nav', 'admin-settings-nav', 'admin-logs-nav'].forEach(function (id) {
      byId(id).classList.toggle('hidden', !admin);
    });
  }

  async function getProfile() {
    var profile = first(await rpc('get_my_profile_v2'));
    if (!profile) throw new Error('数据库资料未建立');
    return profile;
  }

  async function stopLive() {
    window.clearInterval(state.notificationTimer);
    window.clearInterval(state.messageTimer);
    state.notificationTimer = 0;
    state.messageTimer = 0;
    if (state.notificationChannel) await db.removeChannel(state.notificationChannel);
    if (state.messageChannel) await db.removeChannel(state.messageChannel);
    state.notificationChannel = null;
    state.messageChannel = null;
  }

  async function logout() {
    await stopLive();
    var result = await db.auth.signOut();
    if (result.error) toast(errorText(result.error));
    state.session = null;
    state.profile = null;
    await route();
  }

  async function route() {
    var token = ++state.routeToken;
    var sessionResult = await db.auth.getSession();
    if (token !== state.routeToken) return;
    state.session = sessionResult.data.session;
    hide(byId('view-app'));
    hide(byId('view-maintenance'));
    if (!state.session) {
      show(byId('view-auth'));
      await stopLive();
      return;
    }
    try {
      state.profile = await getProfile();
      if (token !== state.routeToken) return;
      setAccount(state.profile);
      var settings = await loadPublicSettings();
      hide(byId('view-auth'));
      if (settings.maintenance_mode && state.profile.role === 'user') {
        show(byId('view-maintenance'));
        return;
      }
      show(byId('view-app'));
      await switchPage(state.activePage || 'home');
      await startNotifications();
    } catch (error) {
      show(byId('view-auth'));
      byId('db-status').textContent = errorText(error) === '数据库未升级' ? '请执行 supabase-security.sql' : errorText(error);
      toast(errorText(error));
    }
  }

  async function profilesFor(rows) {
    var ids = Array.from(new Set((rows || []).map(function (row) { return row.author_id; }).filter(Boolean)));
    if (!ids.length) return {};
    var result = await db.from('public_profiles').select('user_id,id,username,nickname,avatar,bio,is_private').in('user_id', ids);
    if (result.error) throw result.error;
    return (result.data || []).reduce(function (map, profile) {
      map[profile.user_id] = profile;
      return map;
    }, {});
  }

  function statusLabel(status) {
    return ({ pending: '待审核', approved: '已发布', rejected: '未通过', banned: '已下架' })[status] || status || '';
  }

  function postCard(post, profile, showStatus) {
    var card = document.createElement('article');
    card.className = 'post-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', '查看动态');
    var images = parseImages(post.images);
    if (images.length) {
      var cover = document.createElement('div');
      cover.className = 'post-cover';
      cover.appendChild(imageNode(images[0], '动态图片'));
      if (images.length > 1) {
        var count = document.createElement('span');
        count.className = 'post-cover-count';
        count.textContent = String(images.length);
        cover.appendChild(count);
      }
      card.appendChild(cover);
    }
    var body = document.createElement('div');
    body.className = 'post-body';
    var author = document.createElement('div');
    author.className = 'post-author';
    author.appendChild(makeAvatar(profile || { username: post.username }));
    var copy = document.createElement('span');
    copy.className = 'post-author-copy';
    var strong = document.createElement('strong');
    strong.textContent = (profile && (profile.nickname || profile.username)) || post.username || '用户';
    var small = document.createElement('small');
    small.textContent = formatTime(post.published_at || post.created_at);
    copy.append(strong, small);
    author.appendChild(copy);
    body.appendChild(author);
    var text = document.createElement('p');
    text.className = 'post-text';
    text.textContent = post.text || (images.length ? '图片动态' : '无内容');
    body.appendChild(text);
    var meta = document.createElement('div');
    meta.className = 'post-meta';
    var likes = document.createElement('span');
    likes.textContent = '赞 ' + String(post.likes || 0);
    meta.appendChild(likes);
    if (showStatus) {
      var status = document.createElement('span');
      status.className = 'status';
      status.textContent = statusLabel(post.status);
      meta.appendChild(status);
    }
    body.appendChild(meta);
    card.appendChild(body);
    function open() { openPost(post); }
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    return card;
  }

  async function renderPosts(container, rows, showStatus) {
    if (!rows || !rows.length) return empty(container, '暂无动态');
    var profiles = await profilesFor(rows);
    container.replaceChildren();
    rows.forEach(function (post) {
      container.appendChild(postCard(post, profiles[post.author_id], showStatus));
    });
  }

  async function loadAnnouncement() {
    try {
      var announcement = first(await rpc('get_active_announcement_v2'));
      if (!announcement) return hide(byId('announcement'));
      byId('announcement-title').textContent = announcement.title || '公告';
      byId('announcement-content').textContent = announcement.content || '';
      show(byId('announcement'));
    } catch (ignore) { hide(byId('announcement')); }
  }

  async function loadFeed() {
    var container = byId('feed-list');
    empty(container, '加载中');
    var result = await db.from('sys_posts')
      .select('id,author_id,username,images,text,privacy,status,likes,created_at,published_at')
      .eq('status', 'approved')
      .eq('privacy', 'public')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(80);
    if (result.error) throw result.error;
    state.feed = result.data || [];
    filterFeed();
  }

  async function filterFeed() {
    var keyword = byId('feed-search').value.trim().toLowerCase();
    var rows = keyword ? state.feed.filter(function (post) {
      return String(post.text || '').toLowerCase().includes(keyword) || String(post.username || '').toLowerCase().includes(keyword);
    }) : state.feed;
    await renderPosts(byId('feed-list'), rows, false);
  }

  async function preparePostImages() {
    var files = Array.from(byId('post-files').files || []);
    if (files.length > 6) throw new Error('最多 6 张图');
    state.uploads = await Promise.all(files.map(function (file) { return compressImage(file, 1600, .82); }));
    var preview = byId('post-previews');
    preview.replaceChildren();
    state.uploads.forEach(function (src) { preview.appendChild(imageNode(src, '待发布图片')); });
    preview.classList.toggle('hidden', !state.uploads.length);
  }

  async function submitPost(event) {
    event.preventDefault();
    var button = byId('post-submit');
    var text = byId('post-text').value.trim();
    if (!text && !state.uploads.length) return toast('内容不能为空');
    setBusy(button, true, '提交中');
    try {
      await rpc('submit_post_v2', {
        p_text: text || null,
        p_images: state.uploads,
        p_privacy: byId('post-privacy').value
      });
      byId('post-form').reset();
      byId('post-previews').replaceChildren();
      hide(byId('post-previews'));
      state.uploads = [];
      toast('已提交审核');
      await loadFeed();
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function postById(id) {
    var result = await db.from('sys_posts')
      .select('id,author_id,username,images,text,privacy,status,likes,created_at,published_at')
      .eq('id', id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  async function openPost(post) {
    try {
      if (!post || !post.id) return;
      post = await postById(post.id) || post;
      state.activePost = post;
      var profiles = await profilesFor([post]);
      var author = profiles[post.author_id] || { username: post.username };
      state.activePost.author = author;
      byId('detail-author').textContent = author.nickname || author.username || '用户';
      byId('detail-time').textContent = formatTime(post.published_at || post.created_at);
      byId('detail-text').textContent = post.text || '';
      byId('detail-like-count').textContent = String(post.likes || 0);
      var media = byId('detail-media');
      media.replaceChildren();
      parseImages(post.images).forEach(function (src) { media.appendChild(imageNode(src, '动态图片')); });
      media.classList.toggle('hidden', !media.children.length);
      var mine = post.author_id === state.session.user.id;
      byId('detail-follow').classList.toggle('hidden', mine || !post.author_id);
      byId('detail-report').classList.toggle('hidden', mine);
      await refreshPostActions();
      await loadComments();
      openDialog('post-dialog');
    } catch (error) { toast(errorText(error)); }
  }

  async function refreshPostActions() {
    var post = state.activePost;
    if (!post) return;
    var like = await db.from('sys_likes').select('id').eq('post_id', post.id).eq('user_id', state.session.user.id).maybeSingle();
    var favorite = await db.from('sys_favorites').select('id').eq('post_id', post.id).eq('user_id', state.session.user.id).maybeSingle();
    byId('detail-like').classList.toggle('selected', !!like.data);
    byId('detail-favorite').textContent = favorite.data ? '已收藏' : '收藏';
    if (post.author_id && post.author_id !== state.session.user.id) {
      var follow = await db.from('sys_follows').select('id').eq('follower_id', state.session.user.id).eq('following_id', post.author_id).maybeSingle();
      byId('detail-follow').textContent = follow.data ? '已关注' : '关注';
    }
  }

  async function loadComments() {
    var container = byId('comment-list');
    var result = await db.from('sys_comments').select('id,user_id,username,content,created_at').eq('post_id', state.activePost.id).eq('status', 'approved').order('created_at');
    if (result.error) throw result.error;
    if (!result.data || !result.data.length) return empty(container, '暂无评论');
    container.replaceChildren();
    result.data.forEach(function (comment) {
      var card = document.createElement('article');
      card.className = 'comment-card';
      var strong = document.createElement('strong');
      strong.textContent = comment.username || '用户';
      var text = document.createElement('p');
      text.textContent = comment.content;
      var time = document.createElement('small');
      time.textContent = formatTime(comment.created_at);
      card.append(strong, text, time);
      container.appendChild(card);
    });
  }

  async function submitComment(event) {
    event.preventDefault();
    var input = byId('comment-input');
    var content = input.value.trim();
    if (!content || !state.activePost) return;
    var button = event.submitter;
    setBusy(button, true, '发送中');
    try {
      await rpc('add_comment_v2', { p_post_id: state.activePost.id, p_content: content });
      input.value = '';
      toast('已评论');
      await loadComments();
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function toggleLike() {
    if (!state.activePost) return;
    setBusy(byId('detail-like'), true, '处理中');
    try {
      var data = first(await rpc('toggle_like_v2', { p_post_id: state.activePost.id }));
      if (typeof data === 'string') data = JSON.parse(data);
      state.activePost.likes = data && Number.isFinite(Number(data.likes)) ? Number(data.likes) : state.activePost.likes;
      byId('detail-like-count').textContent = String(state.activePost.likes || 0);
      toast(data && data.liked ? '已点赞' : '已取消');
      await loadFeed();
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(byId('detail-like'), false); }
  }

  async function toggleFavorite() {
    if (!state.activePost) return;
    var button = byId('detail-favorite');
    setBusy(button, true, '处理中');
    try {
      var active = await rpc('toggle_favorite_v2', { p_post_id: state.activePost.id });
      button.textContent = active ? '已收藏' : '收藏';
      toast(active ? '已收藏' : '已取消');
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function toggleFollow() {
    var post = state.activePost;
    if (!post || !post.author_id) return;
    var button = byId('detail-follow');
    setBusy(button, true, '处理中');
    try {
      var active = await rpc('toggle_follow_v2', { p_target_user_id: post.author_id });
      button.textContent = active ? '已关注' : '关注';
      toast(active ? '已关注' : '已取消');
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!state.activePost) return;
    var reason = byId('report-reason').value.trim();
    if (reason.length < 3) return toast('请说明原因');
    var button = event.submitter;
    setBusy(button, true, '提交中');
    try {
      await rpc('create_report_v2', { p_post_id: state.activePost.id, p_reason: reason });
      byId('report-form').reset();
      closeDialog('report-dialog');
      closeDialog('post-dialog');
      toast('已提交审核');
      await loadFeed();
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function loadProfile() {
    var profile = state.profile;
    setAvatar(document.querySelector('[data-profile-avatar]'), profile);
    byId('profile-username').textContent = '@' + profile.username;
    byId('profile-name').textContent = profile.nickname || profile.username;
    byId('profile-bio').textContent = profile.bio || '暂无简介';
    var following = await db.from('sys_follows').select('id', { count: 'exact', head: true }).eq('follower_id', profile.user_id);
    var followers = await db.from('sys_follows').select('id', { count: 'exact', head: true }).eq('following_id', profile.user_id);
    byId('profile-following').textContent = String(following.count || 0);
    byId('profile-followers').textContent = String(followers.count || 0);
    byId('edit-username').value = profile.username || '';
    byId('edit-nickname').value = profile.nickname || '';
    byId('edit-gender').value = profile.gender || '保密';
    byId('edit-avatar').value = profile.avatar || '';
    byId('edit-bio').value = profile.bio || '';
    byId('edit-private').checked = !!profile.is_private;
    await loadProfilePosts();
  }

  async function loadProfilePosts() {
    var result = await db.from('sys_posts').select('id,author_id,username,images,text,privacy,status,likes,created_at,published_at').eq('author_id', state.session.user.id).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    await renderPosts(byId('profile-posts'), result.data || [], true);
  }

  async function loadProfileFavorites() {
    var favorites = await db.from('sys_favorites').select('post_id').eq('user_id', state.session.user.id).order('created_at', { ascending: false });
    if (favorites.error) throw favorites.error;
    var ids = (favorites.data || []).map(function (row) { return row.post_id; });
    if (!ids.length) return empty(byId('profile-favorites'), '暂无收藏');
    var posts = await db.from('sys_posts').select('id,author_id,username,images,text,privacy,status,likes,created_at,published_at').in('id', ids);
    if (posts.error) throw posts.error;
    var order = new Map(ids.map(function (id, index) { return [String(id), index]; }));
    posts.data.sort(function (a, b) { return order.get(String(a.id)) - order.get(String(b.id)); });
    await renderPosts(byId('profile-favorites'), posts.data, false);
  }

  async function switchProfileTab(name) {
    document.querySelectorAll('[data-profile-tab]').forEach(function (button) { button.classList.toggle('active', button.dataset.profileTab === name); });
    ['posts', 'favorites', 'edit'].forEach(function (value) { byId('profile-' + value + '-panel').classList.toggle('hidden', value !== name); });
    if (name === 'favorites') await loadProfileFavorites();
    if (name === 'posts') await loadProfilePosts();
  }

  async function saveProfile(event) {
    event.preventDefault();
    var button = event.submitter;
    var username = byId('edit-username').value.trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) return toast('用户名格式错误');
    setBusy(button, true, '保存中');
    try {
      var profile = first(await rpc('update_my_profile_v2', {
        p_username: username,
        p_nickname: byId('edit-nickname').value.trim(),
        p_gender: byId('edit-gender').value,
        p_bio: byId('edit-bio').value.trim(),
        p_avatar: byId('edit-avatar').value.trim(),
        p_is_private: byId('edit-private').checked
      }));
      state.profile = profile || await getProfile();
      setAccount(state.profile);
      await loadProfile();
      toast('已保存');
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function resetPassword() {
    var email = state.session && state.session.user && state.session.user.email;
    if (!email) return toast('邮箱不可用');
    var result = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    toast(result.error ? errorText(result.error) : '请查收邮件');
  }

  function updateBadges() {
    var unread = state.notifications.filter(function (item) { return !item.is_read; }).length;
    ['nav-badge', 'message-badge'].forEach(function (id) {
      var badge = byId(id);
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    });
    byId('notification-summary').textContent = unread ? unread + ' 条未读' : '暂无未读';
  }

  function notificationCard(item) {
    var card = document.createElement('article');
    card.className = 'notification-card' + (item.is_read ? '' : ' unread');
    var head = document.createElement('div');
    head.className = 'notification-head';
    var title = document.createElement('strong');
    title.textContent = ({
      like: '点赞', favorite: '收藏', follow: '关注', comment: '评论', message: '私信',
      friend_request: '好友申请', friend_accepted: '申请通过', system: '系统'
    })[item.type] || '提醒';
    var time = document.createElement('small');
    time.textContent = formatTime(item.created_at);
    head.append(title, time);
    var content = document.createElement('p');
    content.textContent = item.content || '新提醒';
    card.append(head, content);
    var actions = document.createElement('div');
    actions.className = 'notification-actions';
    if (item.type === 'friend_request' && item.friend_request_id) {
      var accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'button primary compact';
      accept.textContent = '接受';
      accept.addEventListener('click', function () { respondFriend(item.friend_request_id, true); });
      var reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'button secondary compact';
      reject.textContent = '忽略';
      reject.addEventListener('click', function () { respondFriend(item.friend_request_id, false); });
      actions.append(accept, reject);
    } else if (item.post_id) {
      var view = document.createElement('button');
      view.type = 'button';
      view.className = 'button secondary compact';
      view.textContent = '查看';
      view.addEventListener('click', async function () {
        var post = await postById(item.post_id);
        if (post) openPost(post); else toast('内容不可用');
      });
      actions.appendChild(view);
    } else if (item.type === 'message' && item.actor_id) {
      var chat = document.createElement('button');
      chat.type = 'button';
      chat.className = 'button secondary compact';
      chat.textContent = '回复';
      chat.addEventListener('click', function () {
        var peer = state.friends.find(function (friend) { return friend.user_id === item.actor_id; });
        if (peer) openChat(peer); else toast('好友不可用');
      });
      actions.appendChild(chat);
    }
    if (actions.children.length) card.appendChild(actions);
    return card;
  }

  async function loadNotifications(silent) {
    if (!state.session || state.notificationBusy) return;
    state.notificationBusy = true;
    try {
      var result = await db.from('sys_notifications')
        .select('id,recipient_id,actor_id,type,content,post_id,comment_id,message_id,friend_request_id,metadata,is_read,created_at')
        .order('created_at', { ascending: false })
        .limit(80);
      if (result.error) throw result.error;
      state.notifications = result.data || [];
      updateBadges();
      var container = byId('notification-list');
      if (!state.notifications.length) empty(container, '暂无提醒');
      else {
        container.replaceChildren();
        state.notifications.forEach(function (item) { container.appendChild(notificationCard(item)); });
      }
    } catch (error) { if (!silent) toast(errorText(error)); }
    finally { state.notificationBusy = false; }
  }

  async function markNotificationsRead() {
    var ids = state.notifications.filter(function (item) { return !item.is_read; }).map(function (item) { return item.id; });
    if (!ids.length) return;
    try {
      await rpc('mark_notifications_read_v2', { p_ids: ids });
      state.notifications.forEach(function (item) { item.is_read = true; });
      updateBadges();
      document.querySelectorAll('.notification-card.unread').forEach(function (card) { card.classList.remove('unread'); });
    } catch (error) { toast(errorText(error)); }
  }

  async function openNotifications() {
    state.activePeer = null;
    show(byId('notifications-view'));
    hide(byId('chat-view'));
    document.querySelectorAll('.person-row').forEach(function (row) { row.classList.remove('selected'); });
    byId('notifications-open').classList.add('selected');
    await loadNotifications(false);
    await markNotificationsRead();
  }

  async function startNotifications() {
    await loadNotifications(true);
    if (state.notificationChannel) await db.removeChannel(state.notificationChannel);
    state.notificationChannel = db.channel('tb-notifications-' + state.session.user.id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'sys_notifications',
        filter: 'recipient_id=eq.' + state.session.user.id
      }, function () { loadNotifications(true); })
      .subscribe();
    window.clearInterval(state.notificationTimer);
    state.notificationTimer = window.setInterval(function () { loadNotifications(true); }, 5000);
  }

  async function respondFriend(requestId, accept) {
    try {
      await rpc('respond_friend_request_v2', { p_request_id: requestId, p_accept: accept });
      toast(accept ? '已添加' : '已忽略');
      await Promise.all([loadNotifications(true), loadFriends()]);
    } catch (error) { toast(errorText(error)); }
  }

  function friendRow(friend) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'person-row';
    button.dataset.peerId = friend.user_id;
    button.appendChild(makeAvatar(friend));
    var copy = document.createElement('span');
    copy.className = 'person-copy';
    var strong = document.createElement('strong');
    strong.textContent = friend.nickname || friend.username;
    var small = document.createElement('small');
    small.textContent = '@' + friend.username;
    copy.append(strong, small);
    button.appendChild(copy);
    button.addEventListener('click', function () { openChat(friend); });
    return button;
  }

  async function loadFriends() {
    try {
      state.friends = (await rpc('list_friends_v2')) || [];
      var container = byId('friends-list');
      if (!state.friends.length) empty(container, '暂无好友');
      else {
        container.replaceChildren();
        state.friends.forEach(function (friend) { container.appendChild(friendRow(friend)); });
      }
    } catch (error) { toast(errorText(error)); }
  }

  function renderMessage(message) {
    var row = document.createElement('div');
    row.className = 'message' + (message.sender_id === state.session.user.id ? ' mine' : '');
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    var image = validUrl(message.content);
    if (image && /^data:image|^https?:/i.test(image)) bubble.appendChild(imageNode(image, '聊天图片'));
    else bubble.appendChild(document.createTextNode(message.content || ''));
    var time = document.createElement('small');
    time.textContent = formatTime(message.created_at);
    bubble.appendChild(time);
    row.appendChild(bubble);
    return row;
  }

  async function loadConversation(silent) {
    if (!state.activePeer || state.messageBusy) return;
    state.messageBusy = true;
    try {
      var rows = (await rpc('get_conversation_messages_v2', {
        p_peer_id: state.activePeer.user_id,
        p_before: null,
        p_limit: 150
      })) || [];
      var signature = rows.map(function (row) { return row.id + ':' + row.created_at; }).join('|');
      if (signature === state.messageSignature) return;
      state.messageSignature = signature;
      var container = byId('chat-list');
      var atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
      if (!rows.length) empty(container, '暂无消息');
      else {
        container.replaceChildren();
        rows.forEach(function (message) { container.appendChild(renderMessage(message)); });
      }
      if (atBottom || !silent) container.scrollTop = container.scrollHeight;
    } catch (error) { if (!silent) toast(errorText(error)); }
    finally { state.messageBusy = false; }
  }

  async function startMessageStream() {
    if (state.messageChannel) await db.removeChannel(state.messageChannel);
    state.messageChannel = db.channel('tb-messages-' + state.session.user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sys_messages' }, function (payload) {
        var row = payload.new || {};
        if (!state.activePeer) return;
        if ((row.sender_id === state.session.user.id && row.receiver_id === state.activePeer.user_id) ||
            (row.receiver_id === state.session.user.id && row.sender_id === state.activePeer.user_id)) loadConversation(true);
      })
      .subscribe();
    window.clearInterval(state.messageTimer);
    state.messageTimer = window.setInterval(function () { loadConversation(true); }, 2500);
  }

  async function openChat(friend) {
    state.activePeer = friend;
    state.messageSignature = '';
    hide(byId('notifications-view'));
    show(byId('chat-view'));
    byId('chat-peer-name').textContent = friend.nickname || friend.username;
    document.querySelectorAll('.person-row').forEach(function (row) { row.classList.toggle('selected', row.dataset.peerId === friend.user_id); });
    await loadConversation(false);
    await startMessageStream();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.activePeer) return toast('请选择好友');
    var input = byId('chat-input');
    var content = input.value.trim();
    if (!content) return;
    var button = byId('chat-send');
    setBusy(button, true, '发送中');
    input.value = '';
    try {
      await rpc('send_message_v2', { p_receiver_id: state.activePeer.user_id, p_content: content, p_client_id: uuid() });
      state.messageSignature = '';
      await loadConversation(true);
    } catch (error) { input.value = content; toast(errorText(error)); }
    finally { setBusy(button, false); input.focus(); }
  }

  async function sendChatImage() {
    if (!state.activePeer) return toast('请选择好友');
    var file = byId('chat-file').files[0];
    if (!file) return;
    try {
      var content = await compressImage(file, 1280, .8);
      await rpc('send_message_v2', { p_receiver_id: state.activePeer.user_id, p_content: content, p_client_id: uuid() });
      byId('chat-file').value = '';
      state.messageSignature = '';
      await loadConversation(true);
    } catch (error) { toast(errorText(error)); }
  }

  function clearChat() {
    if (!state.activePeer) return;
    confirmAction('清空会话', '只对你隐藏这些消息。', async function () {
      await rpc('clear_conversation_v2', { p_peer_id: state.activePeer.user_id });
      state.messageSignature = '';
      await loadConversation(false);
      toast('已清空');
    });
  }

  async function submitFriend(event) {
    event.preventDefault();
    var query = byId('friend-query').value.trim();
    var button = event.submitter;
    if (!query) return;
    setBusy(button, true, '查询中');
    try {
      var request = db.from('public_profiles').select('user_id,id,username,nickname,avatar').limit(1);
      request = /^\d+$/.test(query) ? request.eq('id', Number(query)) : request.ilike('username', query);
      var result = await request.maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('用户不存在');
      if (result.data.user_id === state.session.user.id) throw new Error('不能添加自己');
      await rpc('send_friend_request_v2', { p_target_user_id: result.data.user_id });
      byId('friend-form').reset();
      closeDialog('friend-dialog');
      toast('申请已发送');
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  function adminCard(titleText, textValue) {
    var card = document.createElement('article');
    card.className = 'admin-card';
    var head = document.createElement('div');
    head.className = 'admin-row-head';
    var title = document.createElement('strong');
    title.textContent = titleText;
    head.appendChild(title);
    card.appendChild(head);
    if (textValue) {
      var text = document.createElement('p');
      text.textContent = textValue;
      card.appendChild(text);
    }
    return { card: card, head: head };
  }

  function actionButton(label, primary, handler) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'button ' + (primary ? 'primary' : 'secondary') + ' compact';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function loadReview() {
    var container = byId('review-list');
    empty(container, '加载中');
    try {
      var rows = (await rpc('admin_list_pending_posts_v2')) || [];
      if (!rows.length) return empty(container, '暂无待审');
      container.replaceChildren();
      rows.forEach(function (row) {
        var item = adminCard((row.nickname || row.username || '用户') + ' · #' + row.id, row.text || '图片动态');
        var meta = document.createElement('div');
        meta.className = 'admin-grid';
        ['来源：' + (row.review_reason || '发布'), '举报：' + (row.report_count || 0), formatTime(row.created_at)].forEach(function (value) {
          var span = document.createElement('span'); span.textContent = value; meta.appendChild(span);
        });
        var actions = document.createElement('div');
        actions.className = 'admin-actions';
        actions.append(
          actionButton('通过', true, function () { reviewPost(row.id, 'approved'); }),
          actionButton('拒绝', false, function () { reviewPost(row.id, 'rejected'); })
        );
        item.card.append(meta, actions);
        container.appendChild(item.card);
      });
    } catch (error) { empty(container, errorText(error)); }
  }

  async function reviewPost(id, decision) {
    try {
      await rpc('admin_review_post_v2', { p_post_id: id, p_decision: decision, p_note: null });
      toast(decision === 'approved' ? '已通过' : '已拒绝');
      await loadReview();
    } catch (error) { toast(errorText(error)); }
  }

  async function loadReports() {
    var container = byId('report-list');
    empty(container, '加载中');
    try {
      var rows = (await rpc('admin_list_reports_v2')) || [];
      if (!rows.length) return empty(container, '暂无举报');
      container.replaceChildren();
      rows.forEach(function (row) {
        var item = adminCard('举报 #' + row.id + ' · 动态 #' + row.post_id, row.reason);
        var post = document.createElement('p');
        post.textContent = row.post_text || '内容不可用';
        var actions = document.createElement('div');
        actions.className = 'admin-actions';
        actions.append(
          actionButton('恢复', true, function () { resolveReport(row.id, 'approve'); }),
          actionButton('下架', false, function () { resolveReport(row.id, 'remove'); }),
          actionButton('忽略', false, function () { resolveReport(row.id, 'dismiss'); })
        );
        item.card.append(post, actions);
        container.appendChild(item.card);
      });
    } catch (error) { empty(container, errorText(error)); }
  }

  async function resolveReport(id, action) {
    try {
      await rpc('admin_resolve_report_v2', { p_report_id: id, p_action: action, p_note: null });
      toast('已处理');
      await loadReports();
    } catch (error) { toast(errorText(error)); }
  }

  async function loadUsers() {
    var container = byId('user-list');
    empty(container, '加载中');
    try {
      var rows = (await rpc('admin_list_users_v2', { p_search: null })) || [];
      if (!rows.length) return empty(container, '暂无用户');
      container.replaceChildren();
      rows.forEach(function (row) {
        var item = adminCard((row.nickname || row.username) + ' · #' + row.id, row.email || '未提供邮箱');
        var actions = document.createElement('div');
        actions.className = 'admin-actions';
        var role = document.createElement('select');
        role.setAttribute('aria-label', '用户角色');
        [['user', '成员'], ['auditor', '审核员'], ['admin', '管理员']].forEach(function (option) {
          var node = document.createElement('option'); node.value = option[0]; node.textContent = option[1]; role.appendChild(node);
        });
        role.value = row.role;
        actions.append(role, actionButton(row.is_banned ? '解封' : '封禁', false, function () {
          saveUser(row.user_id, role.value, !row.is_banned);
        }), actionButton('保存角色', true, function () {
          saveUser(row.user_id, role.value, row.is_banned);
        }));
        item.card.appendChild(actions);
        container.appendChild(item.card);
      });
    } catch (error) { empty(container, errorText(error)); }
  }

  async function saveUser(userId, role, banned) {
    try {
      await rpc('admin_set_user_v2', { p_user_id: userId, p_role: role, p_is_banned: banned });
      toast('已保存');
      await loadUsers();
    } catch (error) { toast(errorText(error)); }
  }

  async function loadSiteForm() {
    var settings = first(await rpc('get_public_site_settings_v2')) || {};
    byId('site-title').value = /^小窝(?:QWQ)?$/.test(settings.site_title || '') ? BRAND : (settings.site_title || BRAND);
    byId('site-background').value = settings.home_background_url || '';
    byId('site-overlay').value = Number(settings.home_background_overlay || .35);
    byId('site-maintenance').checked = !!settings.maintenance_mode;
  }

  async function saveSite(event) {
    event.preventDefault();
    var button = event.submitter;
    setBusy(button, true, '保存中');
    try {
      var settings = first(await rpc('admin_update_site_settings_v2', {
        p_site_title: byId('site-title').value.trim() || BRAND,
        p_home_background_url: byId('site-background').value.trim() || null,
        p_home_background_overlay: Number(byId('site-overlay').value),
        p_maintenance_mode: byId('site-maintenance').checked
      }));
      applySettings(settings);
      toast('已保存');
    } catch (error) { toast(errorText(error)); }
    finally { setBusy(button, false); }
  }

  async function loadLogs() {
    var container = byId('log-list');
    empty(container, '加载中');
    try {
      var rows = (await rpc('admin_list_logs_v2', { p_limit: 100 })) || [];
      if (!rows.length) return empty(container, '暂无日志');
      container.replaceChildren();
      rows.forEach(function (row) {
        var item = adminCard(row.username || '系统', row.action || row.event_type);
        var time = document.createElement('small');
        time.textContent = formatTime(row.created_at);
        item.head.appendChild(time);
        container.appendChild(item.card);
      });
    } catch (error) { empty(container, errorText(error)); }
  }

  async function switchPage(name) {
    var profile = state.profile;
    var staffPage = ['review', 'reports'].includes(name);
    var adminPage = ['users', 'settings', 'logs'].includes(name);
    if ((staffPage && !['admin', 'auditor'].includes(profile.role)) || (adminPage && profile.role !== 'admin')) name = 'home';
    state.activePage = name;
    document.querySelectorAll('[data-page]').forEach(function (page) { page.classList.toggle('active', page.dataset.page === name); });
    document.querySelectorAll('[data-tab]').forEach(function (button) { button.classList.toggle('active', button.dataset.tab === name); });
    closeSidebar();
    try {
      if (name === 'home') await Promise.all([loadFeed(), loadAnnouncement()]);
      else if (name === 'messages') await Promise.all([loadFriends(), openNotifications()]);
      else if (name === 'profile') await loadProfile();
      else if (name === 'review') await loadReview();
      else if (name === 'reports') await loadReports();
      else if (name === 'users') await loadUsers();
      else if (name === 'settings') await loadSiteForm();
      else if (name === 'logs') await loadLogs();
    } catch (error) { toast(errorText(error)); }
  }

  function bindEvents() {
    byId('human-check').addEventListener('click', function () {
      state.verified = true;
      byId('human-check').setAttribute('aria-pressed', 'true');
      byId('human-check-text').textContent = '已验证';
    });
    byId('auth-mode-toggle').addEventListener('click', toggleAuthMode);
    byId('auth-form').addEventListener('submit', submitAuth);
    byId('logout-button').addEventListener('click', logout);
    byId('maintenance-logout').addEventListener('click', logout);
    byId('menu-open').addEventListener('click', openSidebar);
    byId('menu-close').addEventListener('click', closeSidebar);
    byId('sidebar-backdrop').addEventListener('click', closeSidebar);
    document.querySelectorAll('[data-tab]').forEach(function (button) { button.addEventListener('click', function () { switchPage(button.dataset.tab); }); });
    document.querySelectorAll('[data-open-tab]').forEach(function (button) { button.addEventListener('click', function () { switchPage(button.dataset.openTab); }); });
    document.querySelectorAll('[data-close-dialog]').forEach(function (button) { button.addEventListener('click', function () { closeDialog(button.dataset.closeDialog); }); });
    document.querySelectorAll('dialog').forEach(function (dialog) {
      dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    });
    byId('confirm-action').addEventListener('click', async function () {
      var action = state.confirmAction;
      state.confirmAction = null;
      closeDialog('confirm-dialog');
      if (!action) return;
      try { await action(); } catch (error) { toast(errorText(error)); }
    });
    byId('post-files').addEventListener('change', async function () {
      try { await preparePostImages(); } catch (error) { byId('post-files').value = ''; state.uploads = []; hide(byId('post-previews')); toast(errorText(error)); }
    });
    byId('post-form').addEventListener('submit', submitPost);
    byId('feed-search').addEventListener('input', filterFeed);
    byId('feed-refresh').addEventListener('click', loadFeed);
    byId('detail-like').addEventListener('click', toggleLike);
    byId('detail-favorite').addEventListener('click', toggleFavorite);
    byId('detail-follow').addEventListener('click', toggleFollow);
    byId('detail-report').addEventListener('click', function () { openDialog('report-dialog'); });
    byId('comment-form').addEventListener('submit', submitComment);
    byId('report-form').addEventListener('submit', submitReport);
    byId('notifications-open').addEventListener('click', openNotifications);
    byId('add-friend-open').addEventListener('click', function () { openDialog('friend-dialog'); byId('friend-query').focus(); });
    byId('friend-form').addEventListener('submit', submitFriend);
    byId('chat-form').addEventListener('submit', sendMessage);
    byId('chat-file').addEventListener('change', sendChatImage);
    byId('clear-chat').addEventListener('click', clearChat);
    document.querySelectorAll('[data-profile-tab]').forEach(function (button) { button.addEventListener('click', function () { switchProfileTab(button.dataset.profileTab); }); });
    byId('profile-form').addEventListener('submit', saveProfile);
    byId('password-reset').addEventListener('click', resetPassword);
    byId('site-form').addEventListener('submit', saveSite);
    document.querySelectorAll('[data-refresh]').forEach(function (button) {
      button.addEventListener('click', function () {
        ({ review: loadReview, reports: loadReports, users: loadUsers, logs: loadLogs })[button.dataset.refresh]();
      });
    });
  }

  async function boot() {
    bindEvents();
    await loadPublicSettings();
    await route();
    db.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        window.setTimeout(route, 0);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (error) {
      byId('db-status').textContent = errorText(error);
      toast(errorText(error));
    });
  });
})();
