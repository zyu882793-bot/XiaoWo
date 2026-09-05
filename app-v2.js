/* Xiaowo security and realtime compatibility layer. Loaded after index.html. */
(function () {
    'use strict';

    var SUPABASE_URL_V2 = 'https://znrpqissoybeuzivxwbv.supabase.co';
    var SUPABASE_KEY_V2 = 'sb_publishable_CYFgu8QRyoLwKKQK0ttIgg_GAOPwY-f';
    var client = window.supabase.createClient(SUPABASE_URL_V2, SUPABASE_KEY_V2, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    window.currentUser = null;
    window.currentPostAuthor = null;
    window.inspectingUser = null;

    var state = {
        loginMode: true,
        session: null,
        profile: null,
        routeBusy: false,
        activePost: null,
        activePeer: null,
        friends: [],
        profileFilter: 'public',
        uploads: [],
        uploadBusy: false,
        confirmCallback: null,
        captcha: '',
        notificationRows: [],
        notificationOpen: false,
        notificationChannel: null,
        notificationTimer: null,
        chatChannel: null,
        chatTimer: null,
        chatPollBusy: false,
        chatGeneration: 0,
        messageIds: new Set(),
        messageClientIds: new Map()
    };

    function el(id) { return document.getElementById(id); }

    function messageOf(error, fallback) {
        if (error && error.message) return error.message;
        return error ? String(error) : (fallback || '请求失败');
    }

    function toast(value) {
        var text = value instanceof Error ? value.message : String(value || '操作失败');
        var node = el('toast');
        if (!node) return console.warn('[Xiaowo v2]', text);
        node.replaceChildren();
        var icon = document.createElement('i');
        icon.className = 'fas fa-info-circle';
        icon.style.color = 'var(--primary)';
        var span = document.createElement('span');
        span.textContent = text;
        node.append(icon, span);
        node.classList.remove('show');
        void node.offsetWidth;
        node.classList.add('show');
        window.clearTimeout(node._v2Timer);
        node._v2Timer = window.setTimeout(function () { node.classList.remove('show'); }, 3600);
    }

    function first(data) {
        if (Array.isArray(data)) return data[0] || null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (ignore) {}
        }
        return data || null;
    }

    async function rpc(name, args) {
        var result = await client.rpc(name, args || {});
        if (result.error) throw result.error;
        return result.data;
    }

    function makeUuid() {
        if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }

    function validImageUrl(value) {
        if (typeof value !== 'string') return '';
        if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return value;
        try {
            var url = new URL(value, window.location.href);
            return /^(https?:|blob:)$/.test(url.protocol) ? url.href : '';
        } catch (ignore) { return ''; }
    }

    function imagesFrom(value) {
        if (Array.isArray(value)) return value.map(validImageUrl).filter(Boolean);
        if (!value) return [];
        try {
            var parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(validImageUrl).filter(Boolean);
        } catch (ignore) {}
        return String(value).split(',').map(function (item) { return validImageUrl(item.trim()); }).filter(Boolean);
    }

    function setBusy(button, busy, label) {
        if (!button) return;
        if (busy) {
            if (!button.dataset.savedHtml) button.dataset.savedHtml = button.innerHTML;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            if (label) button.textContent = label;
        } else {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            if (button.dataset.savedHtml) {
                button.innerHTML = button.dataset.savedHtml;
                delete button.dataset.savedHtml;
            }
        }
    }

    function avatarNode(profile, size) {
        var node = document.createElement('span');
        node.className = 'avatar';
        node.style.width = size + 'px';
        node.style.height = size + 'px';
        node.style.fontSize = Math.max(10, Math.round(size / 3)) + 'px';
        var url = validImageUrl(profile && profile.avatar);
        if (url) {
            var image = document.createElement('img');
            image.src = url;
            image.alt = '';
            image.className = 'v2-avatar-image';
            node.appendChild(image);
        } else node.textContent = String((profile && profile.username) || '?').slice(0, 1).toUpperCase();
        return node;
    }

    function setAvatar(target, profile) {
        if (!target) return;
        target.replaceChildren();
        target.style.backgroundImage = 'none';
        var url = validImageUrl(profile && profile.avatar);
        if (url) {
            var image = document.createElement('img');
            image.src = url;
            image.alt = '';
            image.className = 'v2-avatar-image';
            target.appendChild(image);
        } else target.textContent = String((profile && profile.username) || '?').slice(0, 1).toUpperCase();
    }

    function showModal(id, focusId) {
        var modal = el(id);
        if (!modal) return;
        modal.classList.remove('hidden');
        document.body.classList.add('v2-modal-open');
        window.requestAnimationFrame(function () {
            modal.classList.add('show');
            var focus = focusId && el(focusId);
            if (focus) focus.focus();
        });
    }

    function hideModal(id) {
        var modal = el(id);
        if (!modal) return;
        modal.classList.remove('show');
        window.setTimeout(function () {
            modal.classList.add('hidden');
            if (!document.querySelector('.modal-overlay.show')) document.body.classList.remove('v2-modal-open');
        }, 220);
    }

    function overlayClose(event, id) {
        if (event && event.target && event.target.id === id) hideModal(id);
    }

    window.showToast = toast;
    window.handleImageError = function (image) {
        image.onerror = null;
        image.removeAttribute('src');
        image.alt = '图片加载失败';
        image.style.display = 'none';
    };

    window.showCustomConfirm = function (title, message, callback) {
        el('confirm-title').textContent = title || '确认操作';
        el('confirm-message').textContent = message || '';
        state.confirmCallback = callback;
        showModal('custom-confirm-modal');
    };

    window.closeConfirmModal = function () {
        state.confirmCallback = null;
        hideModal('custom-confirm-modal');
    };

    function installConfirmButton() {
        var button = el('confirm-submit-btn');
        if (!button || button.dataset.v2Bound) return;
        button.dataset.v2Bound = '1';
        button.addEventListener('click', function () {
            var callback = state.confirmCallback;
            state.confirmCallback = null;
            hideModal('custom-confirm-modal');
            if (callback) Promise.resolve(callback()).catch(function (error) { toast(messageOf(error)); });
        });
    }

    window.generateCaptcha = function () {
        var canvas = el('captcha-canvas');
        if (!canvas) return;
        var alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        state.captcha = '';
        canvas.dataset.verified = '0';
        canvas.setAttribute('aria-label', '点击完成验证');
        var context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#f8fafc';
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (var line = 0; line < 5; line += 1) {
            context.strokeStyle = 'rgba(37,99,235,.3)';
            context.beginPath();
            context.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
            context.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
            context.stroke();
        }
        context.font = '700 14px system-ui';
        context.fillStyle = '#172033';
        context.fillText('点击验证', 34, 30);
        canvas.onclick = function () {
            canvas.dataset.verified = '1';
            canvas.setAttribute('aria-label', '验证已完成');
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = '#f8fafc';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = '#2563eb';
            context.font = '700 14px system-ui';
            context.fillText('已完成', 42, 30);
        };
        canvas.onkeydown = function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                canvas.click();
            }
        };
    };

    function injectStyles() {
        if (el('xiaowo-v2-style')) return;
        var style = document.createElement('style');
        style.id = 'xiaowo-v2-style';
        style.textContent = [
            '.modal-overlay{min-height:100dvh;overflow-y:auto;overscroll-behavior:contain;padding:clamp(12px,3vw,24px)}',
            '.modal-overlay>.card{width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;margin:auto}',
            'body.v2-modal-open{overflow:hidden}',
            '.v2-avatar-image{width:100%;height:100%;display:block;object-fit:cover;border-radius:inherit}',
            '.v2-notification-entry{margin:10px 12px 3px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card-solid)}',
            '.v2-badge{min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:var(--danger);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}',
            '.v2-section-title{padding:12px 20px 7px;color:var(--text-muted);font-size:11px;font-weight:800;letter-spacing:.08em}',
            '.v2-empty{padding:38px;text-align:center;color:var(--text-muted);font-size:14px;font-weight:600}',
            '.v2-notification-list{display:flex;flex-direction:column;gap:12px;padding:20px;overflow:auto}',
            '.v2-notification-card{display:flex;gap:12px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--bg-card-solid)}',
            '.v2-notification-card.unread{border-left:4px solid var(--primary)}',
            '.v2-chat-header{padding:18px 24px;border-bottom:1px solid var(--border);background:var(--bg-card-solid);display:flex;align-items:center;justify-content:space-between;gap:12px}',
            '.v2-chat-tools{display:flex;gap:8px}.v2-chat-search{padding:10px 20px;border-bottom:1px solid var(--border);background:var(--bg-hover)}',
            '.v2-msg-meta{font-size:10px;color:var(--text-muted);margin-top:5px}.v2-msg-pending{opacity:.6}.v2-msg-failed .msg-bubble{outline:2px solid var(--danger)}',
            '.v2-review-actions{display:flex;gap:6px;flex-wrap:wrap}.v2-review-preview{max-width:320px;white-space:normal}',
            '@media(max-width:768px){.modal-overlay{align-items:flex-end;padding:0}.modal-overlay>.card{width:100%;max-width:none;max-height:min(82dvh,720px);border-radius:20px 20px 0 0}.chat-main{min-height:0}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function installAuthUi() {
        var email = el('auth-user');
        var password = el('auth-pass');
        if (!email || !password) return;
        email.placeholder = '邮箱地址';
        email.autocomplete = 'email';
        password.autocomplete = 'current-password';
        if (!el('v2-register-username')) {
            var group = document.createElement('div');
            group.id = 'v2-register-username-group';
            group.className = 'input-group hidden';
            group.innerHTML = '<i class="fas fa-at"></i><input type="text" id="v2-register-username" autocomplete="username" placeholder="用户名（3-32 位字母、数字或下划线）">';
            password.closest('.input-group').before(group);
        }
    }

    function installMessageSidebar() {
        var list = el('friends-list-container');
        if (!list || el('v2-notification-entry')) return;
        var entry = document.createElement('button');
        entry.type = 'button';
        entry.id = 'v2-notification-entry';
        entry.className = 'chat-item v2-notification-entry';
        entry.innerHTML = '<span class="chat-item-content"><span class="avatar" style="width:40px;height:40px"><i class="fas fa-bell"></i></span><span style="font-weight:800">消息提醒</span></span><span class="v2-badge hidden" id="v2-notification-badge">0</span>';
        entry.addEventListener('click', openNotificationCenter);
        var label = document.createElement('div');
        label.className = 'v2-section-title';
        label.textContent = '好友';
        list.before(entry, label);
    }

    function installAuditorQueue() {
        var menu = el('menu-auditor');
        if (!menu || el('v2-auditor-review-link')) return;
        var item = document.createElement('div');
        item.id = 'v2-auditor-review-link';
        item.className = 'nav-item';
        item.innerHTML = '<i class="fas fa-clipboard-check" style="width:24px"></i> 发布审核队列';
        item.addEventListener('click', function () { switchTab('admin-posts', item); });
        menu.prepend(item);
    }

    function installSiteControls() {
        var pane = el('tab-admin-server');
        if (!pane || el('v2-site-settings')) return;
        var card = document.createElement('div');
        card.id = 'v2-site-settings';
        card.className = 'card';
        card.style.cssText = 'max-width:650px;margin-bottom:32px';
        card.innerHTML = '<h3 style="font-size:18px;font-weight:800;margin-bottom:20px">站点外观</h3><div class="input-group"><i class="fas fa-heading"></i><input id="v2-site-title" type="text" maxlength="80" placeholder="站点标题"></div><div class="input-group"><i class="fas fa-image"></i><input id="v2-background-url" type="text" maxlength="2000" placeholder="背景图 URL"></div><button id="v2-save-site" class="btn btn-primary" type="button"><i class="fas fa-save"></i> 保存</button>';
        var firstCard = pane.querySelector('.card');
        if (firstCard) firstCard.before(card);
        else pane.appendChild(card);
        el('v2-save-site').addEventListener('click', saveSiteSettings);
    }

    function compressImage(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('无法读取图片')); };
            reader.onload = function () {
                var image = new Image();
                image.onerror = function () { reject(new Error('图片损坏或格式不支持')); };
                image.onload = function () {
                    var scale = Math.min(1, 1600 / image.width, 1600 / image.height);
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(image.width * scale));
                    canvas.height = Math.max(1, Math.round(image.height * scale));
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', .82));
                };
                image.src = String(reader.result);
            };
            reader.readAsDataURL(file);
        });
    }

    function installUpload() {
        var old = el('upload-file-input');
        if (!old || old.dataset.v2) return;
        var input = old.cloneNode(true);
        input.dataset.v2 = '1';
        old.replaceWith(input);
        input.addEventListener('change', async function () {
            var files = Array.from(input.files || []);
            var preview = el('upload-preview-container');
            var button = document.querySelector('#tab-home button[onclick="submitPost()"]');
            if (files.length > 6) {
                input.value = '';
                return toast('最多 6 张图');
            }
            state.uploadBusy = true;
            state.uploads = [];
            preview.replaceChildren();
            setBusy(button, true, '处理图片中…');
            try {
                files.forEach(function (file) {
                    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type) || file.size > 8 * 1024 * 1024) {
                        throw new Error('仅支持 PNG/JPEG/WebP/GIF，单张不超过 8MB');
                    }
                });
                state.uploads = await Promise.all(files.map(compressImage));
                state.uploads.forEach(function (src) {
                    var image = document.createElement('img');
                    image.src = src;
                    image.className = 'preview-thumb';
                    image.alt = '待发布图片';
                    preview.appendChild(image);
                });
            } catch (error) {
                input.value = '';
                state.uploads = [];
                toast(messageOf(error));
            } finally {
                state.uploadBusy = false;
                setBusy(button, false);
            }
        });
    }

    function installUi() {
        injectStyles();
        installAuthUi();
        installMessageSidebar();
        installAuditorQueue();
        installSiteControls();
        installUpload();
        installConfirmButton();
        if (window.innerWidth <= 768 && el('close-sidebar-icon')) el('close-sidebar-icon').style.display = 'block';
    }

    async function freshProfile() {
        var value = first(await rpc('get_my_profile_v2'));
        if (!value) throw new Error('账号资料尚未创建，请检查数据库注册触发器');
        value.user_id = value.user_id || value.auth_user_id || (state.session && state.session.user.id);
        delete value.password;
        return value;
    }

    function setShell(profile) {
        state.profile = profile;
        window.currentUser = profile;
        sessionStorage.setItem('activeUser', JSON.stringify(profile));
        var name = profile.nickname || profile.username || '用户';
        if (el('current-username')) el('current-username').textContent = name;
        setAvatar(el('sidebar-avatar'), profile);
        setAvatar(el('mobile-avatar'), profile);
        ['menu-user', 'menu-admin', 'menu-auditor'].forEach(function (id) {
            if (el(id)) el(id).style.display = 'none';
        });
        var badge = el('current-role-badge');
        if (profile.role === 'admin') {
            el('menu-admin').style.display = 'flex';
            badge.textContent = '管理员';
            badge.style.color = 'var(--danger)';
        } else if (profile.role === 'auditor') {
            el('menu-auditor').style.display = 'flex';
            badge.textContent = '内容审核员';
            badge.style.color = 'var(--primary)';
        } else {
            el('menu-user').style.display = 'flex';
            badge.textContent = 'UID: #' + (profile.id || '—');
            badge.style.color = 'var(--text-muted)';
        }
    }

    async function loadSiteSettings() {
        var result = await client.from('sys_settings').select('site_title,home_background_url,maintenance_mode').eq('id', 1).maybeSingle();
        if (result.error) throw result.error;
        var settings = result.data || {};
        var title = settings.site_title || '小窝QWQ';
        document.title = title + ' - 社区中心';
        document.querySelectorAll('.sidebar-header span,.mobile-header>span').forEach(function (node) { node.textContent = title; });
        if (el('auth-title') && state.loginMode) el('auth-title').textContent = title;
        if (el('v2-site-title')) el('v2-site-title').value = title;
        if (el('v2-background-url')) el('v2-background-url').value = settings.home_background_url || '';
        if (el('setting-maintenance-toggle')) el('setting-maintenance-toggle').checked = !!settings.maintenance_mode;
        var url = validImageUrl(settings.home_background_url);
        if (url) {
            document.body.style.backgroundImage = 'linear-gradient(rgba(8,15,30,.18),rgba(8,15,30,.18)),url("' + url.replace(/"/g, '%22') + '")';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
        } else {
            document.body.style.backgroundImage = '';
            document.body.style.backgroundSize = '';
            document.body.style.backgroundPosition = '';
        }
        return settings;
    }

    async function routeView() {
        if (state.routeBusy) return;
        state.routeBusy = true;
        try {
            installUi();
            var response = await client.auth.getSession();
            if (response.error) throw response.error;
            state.session = response.data.session;
            el('view-auth').classList.add('hidden');
            el('view-app').classList.add('hidden');
            el('view-maintenance').classList.add('hidden');
            if (!state.session) {
                state.profile = null;
                window.currentUser = null;
                sessionStorage.removeItem('activeUser');
                el('view-auth').classList.remove('hidden');
                generateCaptcha();
                await stopChat();
                await stopNotifications();
                return;
            }
            var profile = await freshProfile();
            setShell(profile);
            var settings = await loadSiteSettings().catch(function () { return {}; });
            if (settings.maintenance_mode && profile.role !== 'admin' && profile.role !== 'auditor') {
                el('view-maintenance').classList.remove('hidden');
                return;
            }
            el('view-app').classList.remove('hidden');
            var selector = profile.role === 'admin' ? '#menu-admin .nav-item' : (profile.role === 'auditor' ? '#menu-auditor .nav-item' : '#menu-user .nav-item');
            var initial = document.querySelector(selector);
            if (initial) initial.click();
            await startNotifications();
        } catch (error) {
            console.error('[Xiaowo v2] route error', error);
            sessionStorage.removeItem('activeUser');
            el('view-app').classList.add('hidden');
            el('view-auth').classList.remove('hidden');
            toast('登录失败：' + messageOf(error));
        } finally {
            state.routeBusy = false;
        }
    }

    async function handleAuth() {
        var email = (el('auth-user').value || '').trim().toLowerCase();
        var password = el('auth-pass').value || '';
        var button = el('auth-btn');
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast('邮箱格式错误');
        if (password.length < 8) return toast('密码至少 8 位');
        if (!el('captcha-canvas') || el('captcha-canvas').dataset.verified !== '1') return toast('请先点击验证');
        setBusy(button, true, state.loginMode ? '登录中…' : '注册中…');
        try {
            if (state.loginMode) {
                var signIn = await client.auth.signInWithPassword({ email: email, password: password });
                if (signIn.error) throw signIn.error;
                toast('已登录');
                await routeView();
            } else {
                var username = (el('v2-register-username').value || '').trim();
                if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new Error('用户名只能包含 3-32 位字母、数字或下划线');
                var signUp = await client.auth.signUp({ email: email, password: password, options: { data: { username: username } } });
                if (signUp.error) throw signUp.error;
                if (signUp.data.session) {
                    toast('已注册');
                    await routeView();
                } else {
                    toast('已注册，请查收邮件');
                    toggleAuthMode(true);
                }
            }
        } catch (error) {
            generateCaptcha();
            toast('验证失败：' + messageOf(error));
        } finally { setBusy(button, false); }
    }

    function toggleAuthMode(forceLogin) {
        state.loginMode = typeof forceLogin === 'boolean' ? forceLogin : !state.loginMode;
        el('v2-register-username-group').classList.toggle('hidden', state.loginMode);
        el('auth-title').textContent = state.loginMode ? '小窝QWQ' : '创建安全账号';
        el('auth-btn').textContent = state.loginMode ? '安全登录' : '注册并验证邮箱';
        el('auth-toggle').textContent = state.loginMode ? '没有账号？立即注册' : '已有账号？返回登录';
        el('auth-pass').autocomplete = state.loginMode ? 'current-password' : 'new-password';
        generateCaptcha();
    }

    window.handleAuth = handleAuth;
    window.toggleAuthMode = toggleAuthMode;

    async function logout() {
        await stopChat();
        await stopNotifications();
        var result = await client.auth.signOut();
        if (result.error) toast('退出失败：' + result.error.message);
        state.session = null;
        state.profile = null;
        window.currentUser = null;
        sessionStorage.removeItem('activeUser');
        await routeView();
    }

    function toggleMobileMenu() {
        if (window.innerWidth > 768) return;
        document.querySelector('.sidebar').classList.toggle('open');
        document.querySelector('.sidebar-overlay').classList.toggle('open');
    }

    async function switchTab(tabId, node) {
        var target = el('tab-' + tabId);
        if (!target) return;
        document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
        if (node) node.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(function (pane) { pane.classList.add('hidden'); pane.classList.remove('fade-in'); });
        target.classList.remove('hidden');
        void target.offsetWidth;
        target.classList.add('fade-in');
        if (window.innerWidth <= 768 && document.querySelector('.sidebar').classList.contains('open')) toggleMobileMenu();
        if (tabId !== 'messages') {
            state.notificationOpen = false;
            await stopChat();
        }
        try {
            if (tabId === 'home') { await Promise.all([renderFeed(), loadLatestAnnouncement()]); }
            else if (tabId === 'messages') { await loadFriendsList(); if (state.activePeer) await openChat(state.activePeer); }
            else if (tabId === 'profile') { switchProfileTab('public'); await loadProfileData(); }
            else if (tabId === 'admin-dashboard') await refreshAdminDashboard();
            else if (tabId === 'admin-users') await refreshAdminUsers();
            else if (tabId === 'admin-posts') await refreshAdminPosts();
            else if (tabId === 'admin-server') { await loadSiteSettings(); await refreshAdminAnnouncements(); }
            else if (tabId === 'admin-logs') await refreshAdminLogs();
            else if (tabId === 'auditor-reports') await refreshAuditorReports();
        } catch (error) { toast('加载失败：' + messageOf(error)); }
    }

    document.addEventListener('DOMContentLoaded', function () {
        injectStyles();
        installConfirmButton();
        installAuthUi();
        var captchaInput = el('auth-captcha-input');
        if (captchaInput) {
            captchaInput.closest('.input-group').classList.add('hidden');
            captchaInput.removeAttribute('required');
        }
        generateCaptcha();
        routeView();
    });
})();

