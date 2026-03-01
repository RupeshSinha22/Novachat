import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Image as ImageIcon, X, Globe, Users, Settings,
  Volume2, VolumeX, Bell, User, Crown, Activity,
  Play, StopCircle, LogOut, Download, Flag, Shield,
  ChevronRight, Wifi, WifiOff, Check, AlertTriangle,
  BarChart2, Hash, Clock, UserPlus, UserCheck, UserX, Heart,
  MessageSquare, Eye, Trash2, Paperclip, Smile, Camera, Plus
} from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { ChatService, ChatMessage } from './StompClient';
import { signInWithGoogle, logoutUser, auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import GifPicker from './GifPicker';
import './App.css';

// ─── Types ────────────────────────────────────
type AppState = 'SPLASH' | 'HOME' | 'MATCHING' | 'CHATTING' | 'DISCONNECTED' | 'ADMIN' | 'FRIENDS' | 'DM_CHAT';
type ModalType = 'none' | 'settings' | 'report' | 'confirm_skip' | 'upgrade' | 'image_preview' | 'add_friend' | 'terms' | 'gif_picker' | 'stranger_profile';

interface FriendshipData {
  id: number;
  senderId: string;
  receiverId: string;
  senderNickname: string;
  receiverNickname: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'BLOCKED';
  createdAt?: string;
}

interface UserProfile {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  country?: string;
  language?: string;
  interests?: string;
  gender?: string;
  publicProfile?: boolean;
  reputationScore?: number;
  premium?: boolean;
}

const INTERESTS_OPTIONS = ['Gaming', 'Music', 'Tech', 'Art', 'Movies', 'Travel', 'Sports', 'Anime', 'Books', 'Food', 'Fitness', 'Photography'];
const REPORT_REASONS = ['SPAM', 'ABUSE', 'EXPLICIT_CONTENT', 'HARASSMENT', 'UNDERAGE', 'OTHER'];
const API = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';
// ⚠️ Admin emails — only these users see the Admin panel
const ADMIN_EMAILS = ['rupuom7@gmail.com'];

// Lazy-load Razorpay SDK only when payment is needed
let razorpayLoaded = false;
function loadRazorpay(): Promise<void> {
  if (razorpayLoaded || (window as any).Razorpay) {
    razorpayLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => { razorpayLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
    document.head.appendChild(script);
  });
}

function generateNickname() {
  const adj = ['Swift', 'Cosmic', 'Shadow', 'Neon', 'Frost', 'Blaze', 'Storm', 'Ghost', 'Luna', 'Echo'];
  const noun = ['Wolf', 'Tiger', 'Phoenix', 'Raven', 'Cipher', 'Nova', 'Vortex', 'Hawk', 'Drake', 'Fox'];
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + Math.floor(1000 + Math.random() * 9000);
}

function formatTime(ts?: string) {
  if (!ts) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── App ────────────────────────────────────
export default function App() {
  // Core state
  const [appState, setAppState] = useState<AppState>('SPLASH');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [modal, setModal] = useState<ModalType>('none');
  const [previewImg, setPreviewImg] = useState('');

  // Auth
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuth] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Settings form
  const [settingsNickname, setSettingsNickname] = useState('');
  const [settingsInterests, setSettingsInterests] = useState<string[]>([]);
  const [settingsCountry, setSettingsCountry] = useState('');
  const [settingsPublicProfile, setSettingsPublicProfile] = useState(true);

  const [strangerProfile, setStrangerProfile] = useState<UserProfile | null>(null);

  // Preferences
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(() => {
    const saved = localStorage.getItem('user_interests');
    return saved ? saved.split(',').filter(Boolean) : [];
  });

  // Gender filter (who I want to chat with)
  const [genderFilter, setGenderFilter] = useState<'ANY' | 'MALE' | 'FEMALE'>(
    () => (localStorage.getItem('gender_filter') as 'ANY' | 'MALE' | 'FEMALE') || 'ANY'
  );

  const [interestInput, setInterestInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showDmEmojiPicker, setShowDmEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showDmGifPicker, setShowDmGifPicker] = useState(false);
  const [showMediaTray, setShowMediaTray] = useState(false);

  // Gender & CAPTCHA — remembered after first verification
  const [selectedGender, setSelectedGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>(() => {
    return (localStorage.getItem('user_gender') as 'MALE' | 'FEMALE' | 'OTHER') || '';
  });
  const [captchaA] = useState(() => Math.floor(Math.random() * 9) + 1);
  const [captchaB] = useState(() => Math.floor(Math.random() * 9) + 1);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(() => {
    return localStorage.getItem('captcha_verified') === 'true';
  });
  const [uploading, setUploading] = useState(false);

  // Real-time
  const [isStrangerTyping, setIsStrangerTyping] = useState(false);
  const [strangerNickname, setStrangerNickname] = useState('Stranger');
  const [currentRoom, setCurrentRoom] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'offline'>('offline');
  // Read receipts: how many of MY sent messages the stranger has confirmed reading
  const [readCount, setReadCount] = useState(0);
  const myMsgCountRef = useRef(0); // total messages I have sent
  const [isPremium, setIsPremium] = useState(false);
  const [isStrangerPremium, setIsStrangerPremium] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null);

  // Report
  const [reportReason, setReportReason] = useState('SPAM');
  const [reportDetails, setReportDetails] = useState('');

  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Admin stats
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminReports, setAdminReports] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminPremiumReqs, setAdminPremiumReqs] = useState<any[]>([]);

  // Premium / Payment (Razorpay)
  const [paymentStep, setPaymentStep] = useState<'features' | 'processing' | 'success' | 'error'>('features');
  const [paymentError, setPaymentError] = useState('');

  // Friends
  const [friends, setFriends] = useState<FriendshipData[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendshipData[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendshipData[]>([]);
  const [friendStatus, setFriendStatus] = useState<'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'ACCEPTED'>('NONE');
  const [friendshipId, setFriendshipId] = useState<number | null>(null);
  // The stranger's userId during a chat session:
  const [strangerUserId, setStrangerUserId] = useState<string | null>(null);

  // Admin chat viewer
  const [adminRooms, setAdminRooms] = useState<any[]>([]);
  const [adminSelectedRoom, setAdminSelectedRoom] = useState<string | null>(null);
  const [adminRoomMessages, setAdminRoomMessages] = useState<any[]>([]);

  // Notifications
  const [showNotifications, setShowNotifications] = useState(false);

  // DM (persistent friend chat)
  const [dmFriendId, setDmFriendId] = useState<string | null>(null);
  const [dmFriendNickname, setDmFriendNickname] = useState('');
  const [dmMessages, setDmMessages] = useState<any[]>([]);
  const [dmInput, setDmInput] = useState('');
  const [dmUnreadTotal, setDmUnreadTotal] = useState(0);
  const [dmConversations, setDmConversations] = useState<any[]>([]);
  const [dmSelectedFile, setDmSelectedFile] = useState<File | null>(null);
  const [dmUploading, setDmUploading] = useState(false);
  const dmPollRef = useRef<NodeJS.Timeout | null>(null);
  const dmEndRef = useRef<HTMLDivElement>(null);

  const chatServiceRef = useRef<ChatService | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingTime = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const initFriendsRef = useRef<boolean>(false);
  const initDmRef = useRef<boolean>(false);

  // ── Session persistence helpers ────────────
  const saveSession = (room: string, sNick: string, sUserId: string | null) => {
    sessionStorage.setItem('nc_room', room);
    sessionStorage.setItem('nc_stranger_nick', sNick);
    if (sUserId) sessionStorage.setItem('nc_stranger_id', sUserId);
    sessionStorage.setItem('nc_active', '1');
  };
  const clearSession = () => {
    sessionStorage.removeItem('nc_room');
    sessionStorage.removeItem('nc_stranger_nick');
    sessionStorage.removeItem('nc_stranger_id');
    sessionStorage.removeItem('nc_active');
  };

  // ── Boot ──────────────────────────────────
  useEffect(() => {
    const hasActiveSession = sessionStorage.getItem('nc_active') === '1';
    const timer = setTimeout(() => {
      // Don't override if rejoin already set a different state
      if (!hasActiveSession) {
        setAppState('HOME');
      }
    }, 2200);
    audioRef.current = new Audio();

    // Use Firebase onAuthStateChanged to properly restore auth on refresh
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // Firebase user is signed in — restore session
        const uid = firebaseUser.uid;
        const googleName = firebaseUser.displayName || '';
        setUserId(uid);
        setIsAuth(true);
        const email = firebaseUser.email || '';
        setIsAdmin(ADMIN_EMAILS.includes(email));
        localStorage.setItem('firebase_uid', uid);
        fetchProfile(uid, googleName);
      } else {
        // No Firebase user — check for anon session
        const storedAnon = localStorage.getItem('anon_user_id');
        const storedNick = localStorage.getItem('user_nickname');
        if (storedAnon) {
          setUserId(storedAnon);
          // Set a temporary profile, then fetch from server to get premium status etc.
          const p: UserProfile = { userId: storedAnon, nickname: storedNick || generateNickname() };
          setProfile(p);
          fetchProfile(storedAnon);
        } else {
          // First visit – create anon ID
          const anonId = 'anon_' + Math.random().toString(36).substring(2, 11);
          const nick = generateNickname();
          localStorage.setItem('anon_user_id', anonId);
          localStorage.setItem('user_nickname', nick);
          setUserId(anonId);
          setProfile({ userId: anonId, nickname: nick });
        }
      }
    });

    return () => { clearTimeout(timer); unsubscribe(); };
  }, []);

  // ── Auto-rejoin after page refresh ──────────
  const rejoinAttemptedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!userId || rejoinAttemptedRef.current) return;
    const savedRoom = sessionStorage.getItem('nc_room');
    const savedActive = sessionStorage.getItem('nc_active');
    if (!savedRoom || savedActive !== '1') return;

    rejoinAttemptedRef.current = true;
    const savedNick = sessionStorage.getItem('nc_stranger_nick') || 'Stranger';
    const savedStrangerId = sessionStorage.getItem('nc_stranger_id') || null;
    const myNick = profile?.nickname || localStorage.getItem('user_nickname') || userId;

    console.log('[REJOIN] Attempting to rejoin room:', savedRoom);
    setAppState('MATCHING');

    // Create a new ChatService in rejoin mode
    const service = new ChatService(
      userId,
      (msg) => {
        if (msg.type === 'TYPING') {
          setIsStrangerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsStrangerTyping(false), 2500);
          return;
        }
        if (msg.type === 'READ') {
          setReadCount(myMsgCountRef.current);
          return;
        }
        if (msg.type === 'CHAT' && userId) {
          chatServiceRef.current?.send({ type: 'READ', content: '', senderId: userId });
        }
        setMessages(prev => [...prev, msg]);
      },
      (msg) => {
        if (msg.type === 'MATCHED') {
          setAppState('CHATTING');
          setCurrentRoom(msg.roomName || '');
          setConnectionStatus('connected');
          const sUserId = msg.senderId && msg.senderId !== 'system' ? msg.senderId : savedStrangerId;
          setStrangerUserId(sUserId);
          if (msg.senderNickname && msg.senderNickname !== 'system') {
            setStrangerNickname(msg.senderNickname);
          } else {
            setStrangerNickname(savedNick);
          }
          saveSession(msg.roomName || '', msg.senderNickname || savedNick, sUserId);

          // Load previous messages
          if (msg.content === 'REJOIN' && msg.roomName) {
            fetch(`${API}/chat/messages/${msg.roomName}?userId=${userId}`)
              .then(r => r.ok ? r.json() : [])
              .then((history: ChatMessage[]) => {
                const matchMsg: ChatMessage = { type: 'MATCHED', content: 'Session restored. Previous messages loaded.', senderId: 'system', senderNickname: 'system' };
                setMessages([matchMsg, ...history]);
              })
              .catch(() => {
                setMessages([{ type: 'MATCHED', content: 'Session restored.', senderId: 'system', senderNickname: 'system' }]);
              });
          } else {
            setMessages([{ type: 'MATCHED', content: msg.content, senderId: 'system', senderNickname: 'system' }]);
          }

          if (sUserId && userId) {
            checkFriendStatus(userId, sUserId);
            fetch(`${API}/premium/check/${sUserId}`)
              .then(r => r.json())
              .then(d => setIsStrangerPremium(d.premium || false))
              .catch(() => { });
          }
        } else if (msg.type === 'DISCONNECTED') {
          setMessages(prev => [...prev, { type: 'DISCONNECTED', content: msg.content, senderId: 'system' }]);
          setAppState('DISCONNECTED');
          setConnectionStatus('offline');
          clearSession();
        } else if (msg.type === 'SYSTEM') {
          // Session expired — go to home
          clearSession();
          setAppState('HOME');
        }
      },
      myNick,
      undefined, // dmTargetUserId
      undefined, // interests
      undefined, // genderFilter
      undefined, // gender
      undefined, // isPremium
      savedRoom  // rejoinRoom!
    );

    service.connect();
    chatServiceRef.current = service;
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStrangerTyping]);

  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dmMessages]);

  const showToast = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const playNotif = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (_) { }
  }, [soundEnabled]);

  // ── Profile ───────────────────────────────
  const fetchProfile = async (uid: string, googleDisplayName?: string) => {
    const displayName = googleDisplayName || auth.currentUser?.displayName || '';
    try {
      const res = await fetch(`${API}/profile/${uid}`);
      if (res.ok) {
        const p: UserProfile = await res.json();
        const isRandomDefault = /^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/.test(p.nickname || '');
        // Use Google display name if profile has no nickname or has a random one
        if (displayName && (!p.nickname || p.nickname === uid || isRandomDefault)) {
          p.nickname = displayName;
          // Sync to DB
          fetch(`${API}/profile/${uid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ nickname: displayName }),
          }).catch(() => { });
        }
        if (!p.nickname) p.nickname = displayName || generateNickname();
        setProfile(p);
        setIsPremium(!!p.premium);
        localStorage.setItem('user_nickname', p.nickname);
        if (p.interests && p.interests !== '') {
          const loadedInterests = p.interests.split(',').filter(Boolean);
          setSelectedInterests(loadedInterests);
          localStorage.setItem('user_interests', p.interests);
        }
        return;
      }
    } catch (_) { }
    // Fallback: create a local profile if API fails
    const fallbackNick = displayName || localStorage.getItem('user_nickname') || generateNickname();
    setProfile(prev => prev || { userId: uid, nickname: fallbackNick });
    // Try to create the profile in DB
    if (fallbackNick) {
      fetch(`${API}/profile/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ nickname: fallbackNick }),
      }).catch(() => { });
    }
  };

  const saveProfile = async () => {
    if (!userId) return;
    try {
      const params = new URLSearchParams();
      if (settingsNickname) params.set('nickname', settingsNickname);
      if (settingsCountry) params.set('country', settingsCountry);
      if (settingsInterests.length) params.set('interests', settingsInterests.join(','));
      params.set('publicProfile', String(settingsPublicProfile));

      await fetch(`${API}/profile/${userId}`, { method: 'POST', body: params });
      setProfile(prev => prev ? {
        ...prev,
        nickname: settingsNickname || prev.nickname,
        country: settingsCountry || prev.country,
        interests: settingsInterests.join(',') || prev.interests,
        publicProfile: settingsPublicProfile
      } : prev);
      setSelectedInterests(settingsInterests);
      localStorage.setItem('user_interests', settingsInterests.join(','));
      localStorage.setItem('user_nickname', settingsNickname || profile?.nickname || '');
      showToast('Profile saved!', 'success');
      setModal('none');
    } catch (_) {
      showToast('Failed to save profile.', 'error');
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!userId) return;
    setAvatarUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${API}/profile/${userId}/avatar`, { method: 'POST', body: form });
      if (res.ok) {
        const { url } = await res.json();
        setProfile(prev => prev ? { ...prev, avatarUrl: url } : prev);
        showToast('Avatar updated!', 'success');
      }
    } catch (_) { showToast('Avatar upload failed.', 'error'); }
    finally { setAvatarUploading(false); }
  };

  // ── Auth ──────────────────────────────────
  const handleGoogleLogin = async () => {
    try {
      const user = await signInWithGoogle();
      if (user) {
        const displayName = user.displayName || '';
        setUserId(user.uid);
        setIsAuth(true);
        setIsAdmin(ADMIN_EMAILS.includes(user.email || ''));
        localStorage.setItem('firebase_uid', user.uid);
        if (displayName) localStorage.setItem('user_nickname', displayName);
        await fetchProfile(user.uid, displayName);
        showToast(`Welcome back, ${displayName || 'User'}!`, 'success');
      }
    } catch (_) {
      showToast('Google sign-in failed. Check Firebase config.', 'error');
    }
  };

  const doLogout = () => {
    logoutUser();
    setIsAuth(false);
    setIsAdmin(false);
    const anonId = 'anon_' + Math.random().toString(36).substring(2, 11);
    const nick = generateNickname();
    localStorage.removeItem('firebase_uid');
    localStorage.setItem('anon_user_id', anonId);
    localStorage.setItem('user_nickname', nick);
    setUserId(anonId);
    setProfile({ userId: anonId, nickname: nick });
    showToast('Logged out successfully.', 'info');
  };

  // ── Chat ──────────────────────────────────
  const connectToChat = useCallback(() => {
    if (!userId) return;

    let finalInterests = [...selectedInterests];
    if (interestInput.trim()) {
      const val = interestInput.trim();
      if (!finalInterests.includes(val)) {
        finalInterests.push(val);
      }
      setSelectedInterests(finalInterests);
      setInterestInput('');
    }
    setAppState('MATCHING');
    setMessages([]);
    setStrangerNickname('Stranger');
    setCurrentRoom('');
    setIsStrangerTyping(false);
    setReadCount(0);
    myMsgCountRef.current = 0;
    setShowEmojiPicker(false);
    setShowGifPicker(false);

    chatServiceRef.current?.disconnect();

    // Persist interests + gender to localStorage
    localStorage.setItem('user_interests', finalInterests.join(','));
    localStorage.setItem('gender_filter', genderFilter);
    if (selectedGender) {
      localStorage.setItem('user_gender', selectedGender);
    }

    // Save this user's gender + interests to the backend DB
    if (userId) {
      const params = new URLSearchParams();
      if (selectedGender) params.set('gender', selectedGender);
      if (finalInterests.length) params.set('interests', finalInterests.join(','));
      if (profile?.nickname) params.set('nickname', profile.nickname);
      fetch(`${API}/profile/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      }).catch(() => { });
    }

    const service = new ChatService(
      userId,
      (msg) => {
        if (msg.type === 'TYPING') {
          setIsStrangerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsStrangerTyping(false), 2500);
          return;
        }
        if (msg.type === 'READ') {
          // Stranger confirmed reading — mark all my sent messages as read
          setReadCount(myMsgCountRef.current);
          return;
        }
        // Stranger sent a CHAT message — send READ receipt back
        if (msg.type === 'CHAT' && userId) {
          chatServiceRef.current?.send({ type: 'READ', content: '', senderId: userId });
        }
        setMessages(prev => [...prev, msg]);
      },
      (msg) => {
        if (msg.type === 'MATCHED') {
          setAppState('CHATTING');
          setCurrentRoom(msg.roomName || '');
          setConnectionStatus('connected');
          playNotif();
          // Stranger userId is embedded in msg.senderId by the server on MATCHED
          const sUserId = msg.senderId && msg.senderId !== 'system' ? msg.senderId : null;
          setStrangerUserId(sUserId);
          // Also pick up the stranger's nickname from the match message
          if (msg.senderNickname && msg.senderNickname !== 'system') {
            setStrangerNickname(msg.senderNickname);
          }
          setShowEmojiPicker(false);
          setShowGifPicker(false);
          setFriendStatus('NONE');
          setFriendshipId(null);
          setIsStrangerPremium(false);
          if (sUserId && userId) {
            checkFriendStatus(userId, sUserId);
            // Check if stranger has premium
            fetch(`${API}/premium/check/${sUserId}`)
              .then(r => r.json())
              .then(d => setIsStrangerPremium(d.premium || false))
              .catch(() => { });
          }
          // Save session for page refresh recovery
          saveSession(msg.roomName || '', msg.senderNickname || 'Stranger', sUserId);

          // If this is a rejoin, load previous messages from server
          if (msg.content === 'REJOIN' && msg.roomName && userId) {
            fetch(`${API}/chat/messages/${msg.roomName}?userId=${userId}`)
              .then(r => r.ok ? r.json() : [])
              .then((history: ChatMessage[]) => {
                const matchMsg: ChatMessage = { type: 'MATCHED', content: 'Session restored. Previous messages loaded.', senderId: 'system', senderNickname: 'system' };
                setMessages([matchMsg, ...history]);
              })
              .catch(() => {
                setMessages([{ type: 'MATCHED', content: 'Session restored.', senderId: 'system', senderNickname: 'system' }]);
              });
          } else {
            setMessages([{ type: 'MATCHED', content: msg.content, senderId: 'system', senderNickname: 'system' }]);
          }
          setTimeout(() => {
            document.getElementById('chat-input')?.focus();
          }, 100);
        } else if (msg.type === 'DISCONNECTED') {
          setMessages(prev => [...prev, { type: 'DISCONNECTED', content: msg.content, senderId: 'system' }]);
          setAppState('DISCONNECTED');
          setConnectionStatus('offline');
          clearSession();
          playNotif();
          chatServiceRef.current?.disconnect();
        } else if (msg.type === 'SYSTEM') {
          showToast(msg.content, 'error');
          clearSession();
          setAppState('HOME');
        }
      },
      profile?.nickname,
      undefined,
      finalInterests.join(','),
      genderFilter,
      selectedGender
    );

    service.connect();
    chatServiceRef.current = service;
  }, [userId, profile?.nickname, selectedInterests, genderFilter, selectedGender, playNotif, showToast, interestInput]);

  const skipAndNext = () => {
    setModal('none');
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    clearSession();
    chatServiceRef.current?.disconnect();
    connectToChat();
  };

  const goHome = () => {
    clearSession();
    chatServiceRef.current?.disconnect();
    if (dmPollRef.current) { clearInterval(dmPollRef.current); dmPollRef.current = null; }
    setAppState('HOME');
    setConnectionStatus('offline');
  };

  // ── Messaging ────────────────────────────
  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (appState !== 'CHATTING') return;
    const now = Date.now();
    if (now - lastTypingTime.current > 1500 && userId) {
      chatServiceRef.current?.send({ type: 'TYPING', content: '', senderId: userId, senderNickname: profile?.nickname });
      lastTypingTime.current = now;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const uploadFile = async (): Promise<{ url: string; type: string } | null> => {
    if (!selectedFile) return null;
    setUploading(true);
    const form = new FormData();
    form.append('file', selectedFile);
    try {
      const res = await fetch(`${API}/files/upload`, { method: 'POST', body: form });
      return res.ok ? await res.json() : null;
    } catch (_) { return null; }
    finally { setUploading(false); }
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || appState !== 'CHATTING' || !userId) return;
    let attachment: { url: string; type: string } | null = null;
    if (selectedFile) {
      attachment = await uploadFile();
      if (attachment) localStorage.setItem('photo_sent', 'true');
    }

    const msg: ChatMessage = {
      type: 'CHAT',
      content: input.trim(),
      senderId: userId,
      senderNickname: profile?.nickname || 'You',
      attachmentUrl: attachment?.url,
      attachmentType: attachment?.type,
    };
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    chatServiceRef.current?.send(msg);
    setMessages(prev => [...prev, { ...msg, timestamp: new Date().toISOString() }]);
    myMsgCountRef.current += 1;
    setInput('');
    setSelectedFile(null);
  };

  // ── Download log ──────────────────────────
  const downloadLog = () => {
    if (!messages.length) { showToast('No messages to save.'); return; }
    const text = messages.map(m => {
      if (m.senderId === 'system') return `\n--- ${m.content} ---`;
      const who = m.senderId === userId ? (profile?.nickname || 'You') : strangerNickname;
      return `[${formatTime(m.timestamp)}] ${who}: ${m.content || (m.attachmentUrl ? '[media]' : '')}`;
    }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `NovaChat_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    showToast('Chat log saved!', 'success');
  };

  // ── Report ────────────────────────────────
  const submitReport = async () => {
    if (!userId) return;
    await fetch(`${API}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporterId: userId, reportedId: 'stranger_' + currentRoom, roomName: currentRoom, reason: reportReason, details: reportDetails })
    });
    showToast('Report submitted. Thank you!', 'success');
    setModal('none');
    setReportDetails('');
  };

  // ── Friends ───────────────────────────────
  const loadFriends = async () => {
    if (!userId) return;
    try {
      const [fr, inc, out] = await Promise.all([
        fetch(`${API}/friends/${userId}`).then(r => r.json()),
        fetch(`${API}/friends/${userId}/incoming`).then(r => r.json()),
        fetch(`${API}/friends/${userId}/outgoing`).then(r => r.json()),
      ]);
      setFriends(Array.isArray(fr) ? fr : []);
      const newInc = Array.isArray(inc) ? inc : [];
      setIncomingRequests(prev => {
        if (initFriendsRef.current && newInc.length > prev.length) {
          showToast('You have a new friend request!', 'success');
          playNotif();
        }
        return newInc;
      });
      initFriendsRef.current = true;
      setOutgoingRequests(Array.isArray(out) ? out : []);
    } catch (_) { }
  };

  const checkFriendStatus = async (myId: string, otherId: string) => {
    try {
      const res = await fetch(`${API}/friends/status?userId=${myId}&otherId=${otherId}`);
      if (!res.ok) return;
      const data = await res.json();
      setFriendshipId(data.friendshipId ?? null);
      if (data.status === 'ACCEPTED') {
        setFriendStatus('ACCEPTED');
      } else if (data.status === 'PENDING') {
        setFriendStatus(data.senderId === myId ? 'PENDING_SENT' : 'PENDING_RECEIVED');
      } else {
        setFriendStatus('NONE');
      }
    } catch (_) { }
  };

  // Poll friend status while chatting so "Pending" updates when the other user accepts
  useEffect(() => {
    if (appState !== 'CHATTING' || !userId || !strangerUserId) return;
    if (friendStatus !== 'PENDING_SENT' && friendStatus !== 'PENDING_RECEIVED') return;
    const interval = setInterval(() => {
      checkFriendStatus(userId, strangerUserId);
    }, 8000);
    return () => clearInterval(interval);
  }, [appState, userId, strangerUserId, friendStatus]);

  const sendFriendRequest = async () => {
    if (!userId || !strangerUserId) return;
    try {
      const res = await fetch(`${API}/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: userId,
          receiverId: strangerUserId,
          senderNickname: profile?.nickname || userId,
          receiverNickname: strangerNickname || strangerUserId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setFriendStatus('PENDING_SENT');
        setFriendshipId(data.id);
        setModal('none');
        showToast('Friend request sent! 🎉', 'success');
        loadFriends();
      } else {
        showToast('Could not send request.', 'error');
      }
    } catch (_) { showToast('Network error.', 'error'); }
  };

  const acceptFriendRequest = async (fid: number) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API}/friends/${fid}/accept?userId=${userId}`, { method: 'POST' });
      if (res.ok) {
        showToast('Friend added! 🎉', 'success');
        loadFriends();
        if (strangerUserId) checkFriendStatus(userId, strangerUserId);
      }
    } catch (_) { }
  };

  const declineFriendRequest = async (fid: number) => {
    if (!userId) return;
    try {
      await fetch(`${API}/friends/${fid}/decline?userId=${userId}`, { method: 'POST' });
      showToast('Request declined.', 'info');
      loadFriends();
      if (strangerUserId) checkFriendStatus(userId, strangerUserId);
    } catch (_) { }
  };

  const removeFriend = async (fid: number) => {
    if (!userId) return;
    try {
      await fetch(`${API}/friends/${fid}?userId=${userId}`, { method: 'DELETE' });
      showToast('Friend removed.', 'info');
      loadFriends();
      if (strangerUserId) checkFriendStatus(userId, strangerUserId);
    } catch (_) { }
  };

  const cancelFriendRequest = async (fid: number) => {
    if (!userId) return;
    try {
      await fetch(`${API}/friends/${fid}?userId=${userId}`, { method: 'DELETE' });
      showToast('Request cancelled.', 'info');
      loadFriends();
      if (strangerUserId) checkFriendStatus(userId, strangerUserId);
    } catch (_) { }
  };

  const startDmWithFriend = (friendId: string, friendNickname: string) => {
    if (!userId) return;
    setDmFriendId(friendId);
    setDmFriendNickname(friendNickname);
    setDmMessages([]);
    setDmInput('');
    setDmSelectedFile(null);
    setAppState('DM_CHAT');

    // Load message history
    fetch(`${API}/dm/messages?userId=${userId}&friendId=${friendId}`)
      .then(r => r.json())
      .then(msgs => {
        setDmMessages(Array.isArray(msgs) ? msgs : []);
      })
      .catch(() => { });

    // Mark as read
    fetch(`${API}/dm/read?userId=${userId}&friendId=${friendId}`, { method: 'POST' }).catch(() => { });

    // Start polling for new messages every 3 seconds
    if (dmPollRef.current) clearInterval(dmPollRef.current);
    dmPollRef.current = setInterval(() => {
      fetch(`${API}/dm/messages?userId=${userId}&friendId=${friendId}`)
        .then(r => r.json())
        .then(msgs => {
          if (Array.isArray(msgs)) setDmMessages(msgs);
        })
        .catch(() => { });
      // Also mark as read while chat is open
      fetch(`${API}/dm/read?userId=${userId}&friendId=${friendId}`, { method: 'POST' }).catch(() => { });
    }, 3000);
  };

  const closeDmChat = () => {
    if (dmPollRef.current) { clearInterval(dmPollRef.current); dmPollRef.current = null; }
    setDmSelectedFile(null);
    setAppState('FRIENDS');
    setDmFriendId(null);
    loadDmUnread();
    loadDmConversations();
  };

  const uploadDmFile = async (): Promise<{ url: string; type: string } | null> => {
    if (!dmSelectedFile) return null;
    // Validate file size (max 10 MB)
    if (dmSelectedFile.size > 10 * 1024 * 1024) {
      showToast('File too large. Max 10 MB.', 'error');
      setDmSelectedFile(null);
      return null;
    }
    setDmUploading(true);
    const form = new FormData();
    form.append('file', dmSelectedFile);
    try {
      const res = await fetch(`${API}/files/upload`, { method: 'POST', body: form });
      return res.ok ? await res.json() : null;
    } catch (_) {
      showToast('File upload failed.', 'error');
      return null;
    } finally {
      setDmUploading(false);
    }
  };

  const sendDmMessage = async () => {
    if ((!dmInput.trim() && !dmSelectedFile) || !userId || !dmFriendId) return;

    let attachment: { url: string; type: string } | null = null;
    if (dmSelectedFile) {
      attachment = await uploadDmFile();
      if (attachment) localStorage.setItem('photo_sent', 'true');
      if (!attachment && !dmInput.trim()) return; // upload failed, no text either
    }

    const msg: any = {
      senderId: userId,
      receiverId: dmFriendId,
      content: dmInput.trim(),
      senderNickname: profile?.nickname || userId,
      attachmentUrl: attachment?.url || undefined,
      attachmentType: attachment?.type || undefined,
    };
    setDmInput('');
    setDmSelectedFile(null);
    setShowDmEmojiPicker(false);
    setShowDmGifPicker(false);
    // Optimistically add to local messages
    setDmMessages(prev => [...prev, { ...msg, type: 'CHAT', timestamp: new Date().toISOString() }]);
    try {
      await fetch(`${API}/dm/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
    } catch (_) {
      showToast('Failed to send message.', 'error');
    }
  };

  const loadDmUnread = () => {
    if (!userId) return;
    fetch(`${API}/dm/unread-count?userId=${userId}`)
      .then(r => r.json())
      .then(d => {
        const newUnread = d.unread || 0;
        setDmUnreadTotal(prev => {
          if (initDmRef.current && newUnread > prev) {
            showToast('You have new messages!', 'info');
            playNotif();
          }
          return newUnread;
        });
        initDmRef.current = true;
      })
      .catch(() => { });
  };

  const loadDmConversations = () => {
    if (!userId) return;
    fetch(`${API}/dm/conversations?userId=${userId}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setDmConversations(d); })
      .catch(() => { });
  };

  // Load friends on mount and when userId changes
  useEffect(() => {
    if (userId) {
      initFriendsRef.current = false;
      initDmRef.current = false;
      loadFriends();
      loadDmUnread();
      loadDmConversations();
    }
  }, [userId]);

  // Poll friends and unread count every 10 seconds
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => { loadFriends(); loadDmUnread(); loadDmConversations(); }, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  // ── Admin ─────────────────────────────────
  const loadAdminData = async () => {
    try {
      const [stats, reports, users, premiumReqs] = await Promise.all([
        fetch(`${API}/admin/stats`).then(r => r.json()),
        fetch(`${API}/admin/reports`).then(r => r.json()),
        fetch(`${API}/admin/users`).then(r => r.json()),
        fetch(`${API}/admin/premium/pending`).then(r => r.json()),
      ]);
      setAdminStats(stats);
      setAdminReports(reports);
      setAdminUsers(users);
      setAdminPremiumReqs(premiumReqs);
    } catch (_) { showToast('Failed to load admin data.', 'error'); }
  };

  const banUser = async (uid: string) => {
    await fetch(`${API}/admin/ban/${uid}`, { method: 'POST' });
    showToast('User banned.', 'success');
    loadAdminData();
  };

  const unbanUser = async (uid: string) => {
    await fetch(`${API}/admin/unban/${uid}`, { method: 'POST' });
    showToast('User unbanned.', 'success');
    loadAdminData();
  };

  // Admin chat viewer
  const loadAdminRooms = async () => {
    try {
      const res = await fetch(`${API}/admin/rooms`);
      setAdminRooms(await res.json());
    } catch (_) { }
  };

  const loadRoomMessages = async (room: string) => {
    setAdminSelectedRoom(room);
    try {
      const res = await fetch(`${API}/admin/rooms/${room}/messages`);
      if (res.ok) {
        const data = await res.json();
        setAdminRoomMessages(Array.isArray(data) ? data : []);
      } else {
        setAdminRoomMessages([]);
      }
    } catch (_) {
      setAdminRoomMessages([]);
    }
  };

  const deleteAdminRoom = async (roomName: string) => {
    if (!confirm(`Delete room "${roomName}" and all its messages? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API}/admin/rooms/${roomName}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        showToast(`Deleted ${data.deleted} messages from ${roomName}`, 'success');
        if (adminSelectedRoom === roomName) {
          setAdminSelectedRoom(null);
          setAdminRoomMessages([]);
        }
        loadAdminRooms();
      } else {
        showToast('Failed to delete room', 'error');
      }
    } catch (_) {
      showToast('Failed to delete room', 'error');
    }
  };

  const renderNotifDropdown = () => (
    <AnimatePresence>
      {showNotifications && (
        <motion.div className="notifications-dropdown"
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}>
          <div className="notif-header">
            Notifications
            <button className="notif-close" onClick={() => setShowNotifications(false)}><X size={14} /></button>
          </div>
          <div className="notif-list">
            {incomingRequests.length === 0 && dmUnreadTotal === 0 ? (
              <div className="notif-empty">No new notifications</div>
            ) : (
              <>
                {incomingRequests.map(req => (
                  <div key={`req-${req.id}`} className="notif-item" onClick={() => {
                    setAppState('FRIENDS');
                    setShowNotifications(false);
                    loadFriends();
                    loadDmUnread();
                    loadDmConversations();
                  }}>
                    <div className="notif-icon"><UserPlus size={14} /></div>
                    <div className="notif-content">
                      <strong>{req.senderNickname}</strong> sent a friend request
                    </div>
                  </div>
                ))}
                {dmConversations.filter(c => c.unreadCount > 0).map(c => {
                  const f = friends.find(friend => (friend.senderId === userId ? friend.receiverId : friend.senderId) === c.friendId);
                  const friendName = f ? (f.senderId === userId ? f.receiverNickname : f.senderNickname) : 'A friend';
                  return (
                    <div key={`msg-${c.friendId}`} className="notif-item" onClick={() => {
                      startDmWithFriend(c.friendId, friendName);
                      setShowNotifications(false);
                    }}>
                      <div className="notif-icon"><MessageSquare size={14} /></div>
                      <div className="notif-content">
                        {c.unreadCount} new message(s) from <strong>{friendName}</strong>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="app-root">

      {/* ── Splash Screen ── */}
      <AnimatePresence>
        {appState === 'SPLASH' && (
          <motion.div key="splash" className="splash"
            initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.5 }}>
            <motion.div className="splash-logo"
              initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }}>
              <div className="splash-icon"><Globe size={52} /></div>
              <div className="splash-name">Nova<span>Chat</span></div>
              <p className="splash-tagline">Anonymous. Instant. Global.</p>
            </motion.div>
            <div className="splash-loader" />
          </motion.div>
        )}
      </AnimatePresence>

      {appState !== 'SPLASH' && (
        <>
          {/* ── Top Warning Banner ── */}
          {!isAuthenticated && (
            <div className="anon-banner">
              <span>🔒 Account not linked — chats won't be saved</span>
              <button onClick={handleGoogleLogin}><User size={14} /> Link Google Account</button>
            </div>
          )}

          {/* ── Main Layout ── */}
          <div className="layout">

            {/* ══ SIDEBAR ══ */}
            <aside className="sidebar">
              {/* Logo */}
              <div className="sidebar-logo" onClick={goHome}>
                <div className="logo-icon"><Globe size={20} /></div>
                Nova<span>Chat</span>
              </div>

              {/* Nav */}
              <nav className="sidebar-nav">
                <button className={`nav-item ${appState === 'HOME' ? 'active' : ''}`} onClick={goHome}>
                  <Activity size={18} /> Discover
                </button>
                <button className={`nav-item ${appState === 'FRIENDS' || appState === 'DM_CHAT' ? 'active' : ''}`}
                  onClick={() => { setAppState('FRIENDS'); loadFriends(); loadDmUnread(); loadDmConversations(); }}>
                  <Users size={18} /> Friends
                  {(incomingRequests.length + dmUnreadTotal > 0) && (
                    <span className="nav-badge">{incomingRequests.length + dmUnreadTotal}</span>
                  )}
                </button>
                {/* Admin — only shown to authenticated admins */}
                {isAdmin && (
                  <button className={`nav-item ${appState === 'ADMIN' ? 'active' : ''}`}
                    onClick={() => { setAppState('ADMIN'); loadAdminData(); loadAdminRooms(); }}>
                    <Shield size={18} /> Admin
                  </button>
                )}
              </nav>

              {/* Interests — tag input */}
              <div className="sidebar-section">
                <div className="section-label">Your Interests</div>

                {/* Selected chips */}
                {selectedInterests.length > 0 && (
                  <div className="selected-chips">
                    {selectedInterests.map(i => (
                      <span key={i} className="chip">
                        {i}
                        <button onClick={() => setSelectedInterests(prev => prev.filter(x => x !== i))}>×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Input + suggestions */}
                <div className="interest-input-wrap">
                  <input
                    id="sidebar-interest-input"
                    name="sidebar-interest"
                    className="interest-input"
                    type="text"
                    placeholder="Type an interest…"
                    aria-label="Type an interest"
                    value={interestInput}
                    onChange={e => { setInterestInput(e.target.value); setShowSuggestions(true); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && interestInput.trim()) {
                        const val = interestInput.trim();
                        if (!selectedInterests.includes(val)) setSelectedInterests(prev => [...prev, val]);
                        setInterestInput('');
                        setShowSuggestions(false);
                      }
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  />
                  {showSuggestions && (
                    <div className="suggestions-dropdown">
                      {INTERESTS_OPTIONS
                        .filter(i => i.toLowerCase().includes(interestInput.toLowerCase()) && !selectedInterests.includes(i))
                        .map(i => (
                          <button key={i} className="suggestion-item"
                            onMouseDown={() => {
                              setSelectedInterests(prev => [...prev, i]);
                              setInterestInput('');
                              setShowSuggestions(false);
                            }}>
                            {i}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Live status — only while matching or chatting */}
              {(appState === 'MATCHING' || appState === 'CHATTING') && (
                <div className="sidebar-section online-stats">
                  <Wifi size={14} color="var(--green)" />
                  <span>Connected to network</span>
                </div>
              )}

              {/* Nova Plus */}
              {isPremium ? (
                <div className="premium-card" style={{ borderColor: 'var(--accent)', background: 'rgba(168, 85, 247, 0.1)' }}>
                  <div className="premium-badge" style={{ color: 'var(--accent)' }}><Crown size={14} /> Nova Plus Active ✓</div>
                  <p style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>Unlimited photos &amp; priority matching</p>
                </div>
              ) : (
                <div className="premium-card">
                  <div className="premium-badge"><Crown size={14} /> Nova Plus</div>
                  <p>Priority matching &amp; Image sharing</p>
                  <button className="btn-premium" onClick={() => setModal('upgrade')}>
                    Upgrade <ChevronRight size={14} />
                  </button>
                </div>
              )}

              {/* User Profile */}
              <div className="user-area">
                <div className="user-avatar-wrap" onClick={() => avatarInputRef.current?.click()}>
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="avatar" className="user-avatar-img" />
                  ) : (
                    <div className="user-avatar-placeholder">
                      {(profile?.nickname || 'G')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="avatar-edit-hint">✎</div>
                  {avatarUploading && <div className="avatar-uploading">...</div>}
                  <div className="user-status-dot" />
                </div>
                <input ref={avatarInputRef} id="avatar-upload" name="avatar" type="file" style={{ display: 'none' }} accept="image/*"
                  aria-label="Upload avatar"
                  onChange={e => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
                <div className="user-meta">
                  <div className="user-name">{profile?.nickname || 'Guest'}</div>
                  <div className="user-sub">{isAuthenticated ? '● Verified' : '○ Anonymous'}</div>
                </div>
                <div className="user-btns" style={{ position: 'relative' }}>
                  <button title="Notifications" onClick={() => setShowNotifications(s => !s)} className="notif-bell-btn">
                    <Bell size={15} />
                    {(incomingRequests.length + dmUnreadTotal > 0) && (
                      <span className="notif-dot" />
                    )}
                  </button>
                  {renderNotifDropdown()}

                  <button title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
                    onClick={() => setSoundEnabled(s => !s)}>
                    {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  </button>
                  <button title="Settings" onClick={() => {
                    setSettingsNickname(profile?.nickname || '');
                    setSettingsCountry(profile?.country || '');
                    setSettingsInterests(profile?.interests?.split(',').filter(Boolean) || []);
                    setSettingsPublicProfile(profile?.publicProfile !== false);
                    setModal('settings');
                  }}>
                    <Settings size={15} />
                  </button>
                  {isAuthenticated
                    ? <button title="Log out" onClick={doLogout}><LogOut size={15} /></button>
                    : <button title="Sign in" onClick={handleGoogleLogin}><User size={15} /></button>
                  }
                </div>
              </div>
            </aside>

            {/* ══ MAIN AREA ══ */}
            <main className="main">

              {/* ── Topbar ── */}
              <header className="topbar">
                <div className="topbar-left">
                  {appState === 'CHATTING' && <span className="status-dot green" />}
                  {appState === 'DISCONNECTED' && <span className="status-dot red" />}
                  {appState === 'MATCHING' && <span className="status-dot pulse amber" />}
                  <span className="topbar-title"
                    style={appState === 'CHATTING' ? { cursor: 'pointer', color: 'var(--accent)', fontWeight: 'bold' } : {}}
                    onClick={async () => {
                      if (appState === 'CHATTING' && strangerUserId) {
                        setModal('stranger_profile');
                        try {
                          const res = await fetch(`${API}/profile/${strangerUserId}`);
                          if (res.ok) setStrangerProfile(await res.json());
                          else setStrangerProfile({ userId: strangerUserId, nickname: strangerNickname, publicProfile: false });
                        } catch (e) {
                          setStrangerProfile({ userId: strangerUserId, nickname: strangerNickname, publicProfile: false });
                        }
                      }
                    }}>
                    {appState === 'HOME' && 'Global Discovery'}
                    {appState === 'MATCHING' && 'Scanning Network...'}
                    {appState === 'CHATTING' && strangerNickname}
                    {appState === 'DISCONNECTED' && 'Connection Ended'}
                    {appState === 'ADMIN' && 'Admin Panel'}
                    {appState === 'FRIENDS' && 'Friends'}
                    {appState === 'DM_CHAT' && `💬 ${dmFriendNickname}`}
                  </span>
                  {appState === 'CHATTING' && currentRoom && (
                    <span className="room-badge"><Hash size={12} /> {currentRoom}</span>
                  )}
                </div>
                <div className="topbar-right">
                  {appState === 'CHATTING' && (
                    <>
                      {/* Add Friend button */}
                      {strangerUserId && friendStatus === 'NONE' && (
                        <button className="topbar-btn add-friend-btn" onClick={() => setModal('add_friend')} title="Add Friend">
                          <UserPlus size={17} /> <span className="topbar-btn-label">Add Friend</span>
                        </button>
                      )}
                      {strangerUserId && friendStatus === 'PENDING_SENT' && (
                        <button className="topbar-btn friend-pending-btn" disabled title="Request sent">
                          <UserCheck size={17} /> <span className="topbar-btn-label">Pending</span>
                        </button>
                      )}
                      {strangerUserId && friendStatus === 'PENDING_RECEIVED' && (
                        <button className="topbar-btn add-friend-btn" onClick={() => friendshipId && acceptFriendRequest(friendshipId)} title="Accept Friend Request">
                          <UserCheck size={17} /> <span className="topbar-btn-label">Accept</span>
                        </button>
                      )}
                      {strangerUserId && friendStatus === 'ACCEPTED' && (
                        <button className="topbar-btn friend-accepted-btn" disabled title="Already friends">
                          <Heart size={17} /> <span className="topbar-btn-label">Friends</span>
                        </button>
                      )}
                      <button className="topbar-btn" onClick={downloadLog} title="Download log">
                        <Download size={17} />
                      </button>
                      <button className="topbar-btn danger" onClick={() => setModal('report')} title="Report">
                        <Flag size={17} />
                      </button>
                    </>
                  )}
                  <div className={`conn-badge ${connectionStatus}`}>
                    {connectionStatus === 'connected' ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {connectionStatus}
                  </div>
                </div>
              </header>

              {/* ── Content ── */}
              <div className="content">
                <AnimatePresence>

                  {/* HOME */}
                  {appState === 'HOME' && (
                    <motion.div key="home" className="home-view"
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

                      <div className="hero">
                        <div className="hero-icon"><Globe size={48} strokeWidth={1.5} /></div>
                        <h1>Random Stranger Chat</h1>
                        <p>Talk to strangers worldwide — anonymous, instant, and free. Your next great conversation starts here.</p>
                      </div>

                      <div className="start-card">
                        <div className="start-card-inner">
                          <div className="field-group">
                            <label htmlFor="display-name">Your Display Name</label>
                            <div className="input-with-icon">
                              <User size={16} />
                              <input id="display-name" name="displayName" type="text" value={profile?.nickname || ''} maxLength={20}
                                onChange={e => setProfile(p => p ? { ...p, nickname: e.target.value } : p)}
                                placeholder="Enter nickname..." className="text-field" />
                            </div>
                          </div>

                          {/* Gender Selection — only show if not previously saved */}
                          {!localStorage.getItem('user_gender') && (
                            <div className="field-group">
                              <span className="field-label">I am</span>
                              <div className="gender-selector">
                                <button className={`gender-btn ${selectedGender === 'MALE' ? 'active male' : ''}`}
                                  onClick={() => setSelectedGender('MALE')}>
                                  ♂ Male
                                </button>
                                <button className={`gender-btn ${selectedGender === 'FEMALE' ? 'active female' : ''}`}
                                  onClick={() => setSelectedGender('FEMALE')}>
                                  ♀ Female
                                </button>
                                <button className={`gender-btn ${selectedGender === 'OTHER' ? 'active other' : ''}`}
                                  onClick={() => setSelectedGender('OTHER')}>
                                  ⚧ Other
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Gender Filter — free for all users */}
                          <div className="field-group">
                            <span className="field-label">Chat with</span>
                            <div className="gender-selector">
                              <button className={`gender-btn ${genderFilter === 'ANY' ? 'active other' : ''}`}
                                onClick={() => setGenderFilter('ANY')}>
                                🌍 Anyone
                              </button>
                              <button className={`gender-btn ${genderFilter === 'MALE' ? 'active male' : ''}`}
                                onClick={() => setGenderFilter('MALE')}>
                                ♂ Males
                              </button>
                              <button className={`gender-btn ${genderFilter === 'FEMALE' ? 'active female' : ''}`}
                                onClick={() => setGenderFilter('FEMALE')}>
                                ♀ Females
                              </button>
                            </div>
                          </div>

                          <div className="field-group">
                            <label htmlFor="home-interest-input">Chat Interests <span className="label-hint">(optional — helps matching)</span></label>

                            {/* Selected chips */}
                            {selectedInterests.length > 0 && (
                              <div className="selected-chips">
                                {selectedInterests.map(i => (
                                  <span key={i} className="chip">
                                    {i}
                                    <button onClick={() => setSelectedInterests(prev => prev.filter(x => x !== i))}>×</button>
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="interest-input-wrap">
                              <input
                                id="home-interest-input"
                                name="interest"
                                className="interest-input"
                                type="text"
                                placeholder="e.g. Gaming, Music, Tech…"
                                aria-label="Chat interests"
                                value={interestInput}
                                onChange={e => { setInterestInput(e.target.value); setShowSuggestions(true); }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && interestInput.trim()) {
                                    const val = interestInput.trim();
                                    if (!selectedInterests.includes(val)) setSelectedInterests(prev => [...prev, val]);
                                    setInterestInput('');
                                    setShowSuggestions(false);
                                  }
                                }}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                              />
                              {showSuggestions && (
                                <div className="suggestions-dropdown">
                                  {INTERESTS_OPTIONS
                                    .filter(i => i.toLowerCase().includes(interestInput.toLowerCase()) && !selectedInterests.includes(i))
                                    .map(i => (
                                      <button key={i} className="suggestion-item"
                                        onMouseDown={() => {
                                          setSelectedInterests(prev => [...prev, i]);
                                          setInterestInput('');
                                          setShowSuggestions(false);
                                        }}>
                                        {i}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Robot Verification — only show if not previously verified */}
                          {!localStorage.getItem('captcha_verified') && (
                            <div className="field-group">
                              <label>Verify you're human</label>
                              <div className="captcha-box">
                                <div className="captcha-question">
                                  <Shield size={16} />
                                  <span>What is <strong>{captchaA} + {captchaB}</strong> ?</span>
                                </div>
                                <input
                                  id="captcha-answer"
                                  name="captcha"
                                  type="text"
                                  className="captcha-input"
                                  placeholder="Answer"
                                  aria-label="Captcha answer"
                                  value={captchaAnswer}
                                  onChange={e => {
                                    setCaptchaAnswer(e.target.value);
                                    setCaptchaVerified(parseInt(e.target.value) === captchaA + captchaB);
                                  }}
                                />
                                {captchaVerified && <span className="captcha-ok"><Check size={16} /> Verified</span>}
                              </div>
                            </div>
                          )}

                          <button className="btn-start" onClick={() => {
                            if (!selectedGender) { showToast('Please select your gender.', 'error'); return; }
                            if (!captchaVerified) { showToast('Please solve the captcha.', 'error'); return; }
                            // Save gender & verification for future visits
                            localStorage.setItem('user_gender', selectedGender);
                            localStorage.setItem('captcha_verified', 'true');
                            if (profile) setProfile({ ...profile, gender: selectedGender });
                            connectToChat();
                          }}
                            disabled={!selectedGender || !captchaVerified}
                          >
                            <Play size={20} fill="currentColor" /> Start Chatting
                          </button>
                          <div className="terms-note">
                            By chatting you agree to our <a href="#" onClick={(e) => { e.preventDefault(); setModal('terms'); }}>Terms of Service</a> and confirm you are 18+
                          </div>
                        </div>
                      </div>

                    </motion.div>
                  )}

                  {/* MATCHING */}
                  {appState === 'MATCHING' && (
                    <motion.div key="matching" className="matching-view"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="pulse-ring">
                        <div className="pulse-ring-inner">
                          <Globe size={44} />
                        </div>
                      </div>
                      <h2>Scanning Network</h2>
                      <p>Looking for someone to connect with...</p>
                      <div className="dots-row">
                        <span /><span /><span />
                      </div>
                      <button className="btn-cancel" onClick={goHome}>
                        <StopCircle size={16} /> Cancel
                      </button>
                    </motion.div>
                  )}

                  {/* CHATTING / DISCONNECTED */}
                  {(appState === 'CHATTING' || appState === 'DISCONNECTED') && (
                    <motion.div key="chat" className="chat-view"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                      <div className="messages-list">
                        {(() => {
                          let mySentIndex = 0;
                          return messages.map((msg, idx) => {
                            const isMe = msg.senderId === userId;
                            const isSystem = msg.senderId === 'system' || msg.type === 'MATCHED' || msg.type === 'DISCONNECTED';

                            if (isSystem) return (
                              <motion.div key={idx} className="sys-msg"
                                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                                {msg.type === 'MATCHED' && <span className="sys-icon matched"><Wifi size={13} /></span>}
                                {msg.type === 'DISCONNECTED' && <span className="sys-icon disconnected"><WifiOff size={13} /></span>}
                                {(() => {
                                  // Parse MATCHED|Interest1,Interest2 content
                                  if (msg.type === 'MATCHED' && msg.content?.startsWith('MATCHED|')) {
                                    const sharedRaw = msg.content.slice('MATCHED|'.length);
                                    const shared = sharedRaw.split(',').map(s => s.trim()).filter(Boolean);
                                    return (
                                      <>
                                        <span>You're now chatting with a random stranger. Say hi! 👋</span>
                                        {shared.length > 0 && (
                                          <div className="matched-interests">
                                            <span className="matched-interests-label">✨ Matched on:</span>
                                            {shared.map(interest => (
                                              <span key={interest} className="matched-interest-chip">{interest}</span>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    );
                                  }
                                  return <span>{msg.content}</span>;
                                })()}
                              </motion.div>
                            );

                            // Track index among my sent messages for read receipts
                            let myIdx = -1;
                            if (isMe) { mySentIndex++; myIdx = mySentIndex; }
                            const isRead = isMe && myIdx <= readCount;

                            return (
                              <motion.div key={idx} className={`msg-row ${isMe ? 'me' : 'them'}`}
                                initial={{ opacity: 0, y: 8, x: isMe ? 12 : -12 }}
                                animate={{ opacity: 1, y: 0, x: 0 }}>
                                {!isMe && (
                                  <div className="msg-avatar">
                                    {strangerNickname[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="msg-body">
                                  <div className={`bubble ${isMe ? 'bubble-me' : 'bubble-them'}`}>
                                    {msg.content && <span>{msg.content}</span>}
                                    {msg.attachmentUrl && (
                                      <div className="attachment">
                                        {msg.attachmentType?.startsWith('image') ? (
                                          <img src={msg.attachmentUrl} alt="media"
                                            onClick={() => { setPreviewImg(msg.attachmentUrl!); setModal('image_preview'); }}
                                            className="attach-img" />
                                        ) : (
                                          <video src={msg.attachmentUrl} controls className="attach-video" />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="msg-meta">
                                    <Clock size={10} />
                                    {formatTime(msg.timestamp)}
                                    {isMe && (
                                      isRead
                                        ? <span className="ticks read"><Check size={10} /><Check size={10} /></span>
                                        : <span className="ticks sent"><Check size={10} /></span>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            );
                          });
                        })()}

                        <AnimatePresence>
                          {isStrangerTyping && (
                            <motion.div className="msg-row them typing-row"
                              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                              <div className="msg-avatar">{strangerNickname[0].toUpperCase()}</div>
                              <div className="typing-bubble">
                                <span /><span /><span />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Input bar */}
                      <div className="input-bar">
                        <div className="input-actions-left">
                          <button className="icon-btn" onClick={() => setModal('confirm_skip')} title="Next stranger">
                            <ChevronRight size={20} />
                          </button>
                          <button className="icon-btn danger" onClick={goHome} title="Leave">
                            <LogOut size={18} />
                          </button>
                        </div>

                        <div className="input-wrap" style={{ position: 'relative' }}>
                          {/* Media Tray */}
                          {showMediaTray && (
                            <div className="media-tray">
                              <label className="media-tray-btn" title="Gallery" htmlFor="gallery-upload">
                                <input id="gallery-upload" name="gallery" type="file" accept="image/*,video/*" style={{ display: 'none' }}
                                  onClick={(e) => {
                                    const canSend = isAdmin || isPremium || isStrangerPremium || !localStorage.getItem('photo_sent');
                                    if (!canSend) { e.preventDefault(); setModal('upgrade'); }
                                  }}
                                  onChange={e => { if (e.target.files?.[0]) { setSelectedFile(e.target.files[0]); e.target.value = ''; setShowMediaTray(false); } }} />
                                <ImageIcon size={20} /><span>Gallery</span>
                              </label>
                              <label className="media-tray-btn" title="Camera" htmlFor="camera-upload">
                                {/* capture="environment" only works on mobile — on desktop, omit it so the OS picks the right dialog */}
                                <input id="camera-upload" name="camera" type="file" accept="image/*"
                                  {...(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? { capture: 'environment' as 'environment' } : {})}
                                  style={{ display: 'none' }}
                                  onClick={(e) => {
                                    const canSend = isAdmin || isPremium || isStrangerPremium || !localStorage.getItem('photo_sent');
                                    if (!canSend) { e.preventDefault(); setModal('upgrade'); }
                                  }}
                                  onChange={e => { if (e.target.files?.[0]) { setSelectedFile(e.target.files[0]); e.target.value = ''; setShowMediaTray(false); } }} />
                                <Camera size={20} /><span>Camera</span>
                              </label>
                              <button type="button" className="media-tray-btn" onClick={() => { setShowGifPicker(p => !p); setShowEmojiPicker(false); setShowMediaTray(false); }} disabled={appState === 'DISCONNECTED'}>
                                <div style={{ fontSize: '14px', fontWeight: 'bold' }}>GIF</div><span>GIF</span>
                              </button>
                            </div>
                          )}

                          {/* GIF picker — fixed centred to avoid overflow */}
                          {showGifPicker && (
                            <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 24px)', height: '400px', boxShadow: '0 5px 30px rgba(0,0,0,0.7)', borderRadius: '12px', background: 'var(--bg-1)' }}>
                              <GifPicker onSelect={(url) => { const msg: ChatMessage = { type: 'CHAT', content: '', attachmentUrl: url, attachmentType: 'image/gif', senderId: userId || '', senderNickname: profile?.nickname || 'You' }; chatServiceRef.current?.send(msg); setMessages(prev => [...prev, { ...msg, timestamp: new Date().toISOString() }]); setShowGifPicker(false); }} onClose={() => setShowGifPicker(false)} />
                            </div>
                          )}

                          {/* + button */}
                          <button type="button" className="icon-btn muted" style={{ flexShrink: 0 }}
                            onClick={() => { setShowMediaTray(p => !p); setShowGifPicker(false); setShowEmojiPicker(false); }}
                            disabled={appState === 'DISCONNECTED'}>
                            {showMediaTray ? <X size={20} /> : <Plus size={20} />}
                          </button>

                          {selectedFile && (
                            <div className="file-chip">
                              <ImageIcon size={13} /><span>{selectedFile.name}</span>
                              <button onClick={() => setSelectedFile(null)}><X size={12} /></button>
                            </div>
                          )}

                          <input id="chat-input" type="text" className="msg-input"
                            placeholder={appState === 'DISCONNECTED' ? 'Connection ended' : uploading ? 'Uploading...' : 'Type a message...'}
                            value={input} onChange={handleTyping} onKeyDown={handleKeyDown}
                            disabled={appState === 'DISCONNECTED' || uploading} autoFocus />

                          <button className="icon-btn muted" style={{ flexShrink: 0 }} onClick={() => { setShowEmojiPicker(p => !p); setShowGifPicker(false); setShowMediaTray(false); }} disabled={appState === 'DISCONNECTED'}>
                            <Smile size={18} />
                          </button>
                          {showEmojiPicker && (
                            <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 24px)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 5px 30px rgba(0,0,0,0.7)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)' }}>Emoji</span>
                                <button onClick={() => setShowEmojiPicker(false)} style={{ background: 'var(--bg-3)', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: '4px 6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
                              </div>
                              <EmojiPicker theme={"dark" as any} width={"100%"} height={340} onEmojiClick={(e) => { setInput(prev => prev + e.emoji); setShowEmojiPicker(false); }} />
                            </div>
                          )}

                          <button className="btn-send" onClick={handleSend}
                            disabled={(!input.trim() && !selectedFile) || appState === 'DISCONNECTED' || uploading}>
                            <Send size={18} />
                          </button>
                        </div>
                      </div>

                    </motion.div>
                  )}

                  {/* ADMIN */}
                  {appState === 'ADMIN' && (
                    <motion.div key="admin" className="admin-view"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <h2 className="admin-title"><Shield size={22} /> Admin Panel</h2>

                      {adminStats && (
                        <div className="stat-grid">
                          <div className="stat-card">
                            <BarChart2 size={24} color="var(--green)" />
                            <div className="stat-val">{adminStats.activeChats}</div>
                            <div className="stat-label">Active Chats</div>
                          </div>
                          <div className="stat-card">
                            <Users size={24} color="var(--blue)" />
                            <div className="stat-val">{adminStats.waitingUsers}</div>
                            <div className="stat-label">Waiting</div>
                          </div>
                          <div className="stat-card">
                            <Flag size={24} color="var(--amber)" />
                            <div className="stat-val">{adminStats.pendingReports}</div>
                            <div className="stat-label">Pending Reports</div>
                          </div>
                          <div className="stat-card">
                            <Globe size={24} color="var(--purple)" />
                            <div className="stat-val">{adminStats.totalUsers}</div>
                            <div className="stat-label">Total Users</div>
                          </div>
                        </div>
                      )}

                      <div className="admin-section">
                        <h3><Flag size={16} /> Pending Reports</h3>
                        {adminReports.length === 0 ? (
                          <p className="admin-empty">No pending reports ✓</p>
                        ) : adminReports.map((r: any) => (
                          <div key={r.id} className="admin-report-card">
                            <div><strong>{r.reason}</strong> — {r.details || 'No details'}</div>
                            <div className="text-muted">Reporter: {r.reporterId}</div>
                            <div className="text-muted">Reported: {r.reportedId}</div>
                            <button className="btn-ban" onClick={() => banUser(r.reportedId)}>Ban User</button>
                          </div>
                        ))}
                      </div>

                      <div className="admin-section">
                        <h3><Crown size={16} /> Pending Premium Requests</h3>
                        {adminPremiumReqs.length === 0 ? (
                          <p className="admin-empty">No pending requests ✓</p>
                        ) : adminPremiumReqs.map((req: any) => (
                          <div key={req.id} className="admin-report-card">
                            <div><strong>User:</strong> {req.nickname || req.userId}</div>
                            <div className="text-muted"><strong>Txn ID (UTR):</strong> {req.transactionId}</div>
                            <div className="text-muted"><strong>Requested:</strong> {formatTime(req.requestedAt)}</div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                              <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`${API}/admin/premium/${req.id}/approve`, { method: 'POST' });
                                    if (res.ok) {
                                      showToast('Request Approved', 'success');
                                      loadAdminData(); // refresh list
                                    }
                                  } catch (_) { }
                                }}>Approve</button>
                              <button className="btn-ban" style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`${API}/admin/premium/${req.id}/reject`, { method: 'POST' });
                                    if (res.ok) {
                                      showToast('Request Rejected', 'info');
                                      loadAdminData(); // refresh list
                                    }
                                  } catch (_) { }
                                }}>Reject</button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="admin-section">
                        <h3><Users size={16} /> All Users</h3>
                        <div className="admin-users-list">
                          {adminUsers.map((u: any) => (
                            <div key={u.userId} className={`admin-user-row ${u.banned ? 'banned' : ''}`}>
                              <div className="admin-user-info">
                                <strong>{u.nickname || u.userId}</strong>
                                <span className="text-muted">{u.userId.slice(0, 20)}...</span>
                              </div>
                              <div className="admin-user-score">Rep: {u.reputationScore}</div>
                              {u.banned
                                ? <button className="btn-unban" onClick={() => unbanUser(u.userId)}>Unban</button>
                                : <button className="btn-ban" onClick={() => banUser(u.userId)}>Ban</button>
                              }
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Chat Rooms Viewer */}
                      <div className="admin-section">
                        <h3><MessageSquare size={16} /> Chat Rooms</h3>
                        <div className="admin-rooms-grid">
                          {adminRooms.length === 0 ? (
                            <p className="admin-empty">No chat rooms found.</p>
                          ) : adminRooms.map((r: any) => (
                            <div key={r.roomName} className={`admin-room-card ${adminSelectedRoom === r.roomName ? 'active' : ''}`}>
                              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => loadRoomMessages(r.roomName)}>
                                <div className="admin-room-name"><Hash size={14} /> {r.roomName}</div>
                                <div className="admin-room-count">{r.messageCount} messages</div>
                              </div>
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <button className="admin-room-view-btn" onClick={() => loadRoomMessages(r.roomName)}><Eye size={14} /> View</button>
                                <button className="admin-room-delete-btn" onClick={(e) => { e.stopPropagation(); deleteAdminRoom(r.roomName); }}><Trash2 size={14} /></button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Message viewer for selected room */}
                        {adminSelectedRoom && (
                          <div className="admin-chat-viewer">
                            <div className="admin-chat-header">
                              <h4><Hash size={14} /> {adminSelectedRoom}</h4>
                              <div style={{ display: 'flex', gap: '5px' }}>
                                <button title="Download Chat" onClick={() => {
                                  if (!adminSelectedRoom || !adminRoomMessages.length) return;
                                  const txt = adminRoomMessages.map((m: any) => {
                                    const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
                                    const who = m.senderNickname || m.senderId || 'System';
                                    return `[${time}] ${who}: ${m.content || (m.attachmentUrl ? '[media]' : '')}`;
                                  }).join('\n');
                                  const blob = new Blob([txt], { type: 'text/plain' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `NovaChat_Admin_${adminSelectedRoom}_${new Date().toISOString().slice(0, 10)}.txt`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }} className="admin-download-btn"><Download size={16} /></button>
                                <button onClick={() => setAdminSelectedRoom(null)}><X size={16} /></button>
                              </div>
                            </div>
                            <div className="admin-chat-messages">
                              {adminRoomMessages.length === 0 ? (
                                <p className="admin-empty">No messages in this room.</p>
                              ) : adminRoomMessages.map((msg: any, idx: number) => (
                                <div key={idx} className={`admin-msg ${msg.type === 'MATCHED' || msg.type === 'DISCONNECTED' || msg.type === 'SYSTEM' ? 'system' : ''}`}>
                                  <div className="admin-msg-header">
                                    <span className="admin-msg-sender">{msg.senderNickname || msg.senderId || 'System'}</span>
                                    <span className="admin-msg-time">{msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''}</span>
                                    <span className={`admin-msg-type type-${msg.type?.toLowerCase()}`}>{msg.type}</span>
                                  </div>
                                  {msg.content && <div className="admin-msg-content">{msg.content}</div>}
                                  {msg.attachmentUrl && (
                                    <div className="admin-msg-attachment">
                                      {msg.attachmentType?.startsWith('image') ? (
                                        <img src={msg.attachmentUrl} alt="attachment" className="admin-msg-img" style={{ cursor: 'pointer' }} onClick={() => { setPreviewImg(msg.attachmentUrl); setModal('image_preview'); }} />
                                      ) : msg.attachmentType?.startsWith('video') ? (
                                        <video src={msg.attachmentUrl} controls className="admin-msg-video" />
                                      ) : (
                                        <a href={msg.attachmentUrl} target="_blank" rel="noreferrer" title="Download Media">📎 Attachment</a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* FRIENDS PAGE */}
                  {appState === 'FRIENDS' && (
                    <motion.div key="friends" className="friends-page"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                      <h2 className="friends-page-title"><Users size={24} /> Your Friends</h2>

                      {/* Incoming requests */}
                      {incomingRequests.length > 0 && (
                        <div className="fp-section">
                          <div className="fp-section-header">
                            <Bell size={16} /> Incoming Requests
                            <span className="fp-count">{incomingRequests.length}</span>
                          </div>
                          <div className="fp-cards-grid">
                            {incomingRequests.map(f => (
                              <div key={f.id} className="fp-card incoming">
                                <div className="fp-avatar">{f.senderNickname[0].toUpperCase()}</div>
                                <div className="fp-info">
                                  <div className="fp-name">{f.senderNickname}</div>
                                  <div className="fp-sub">Wants to be your friend</div>
                                </div>
                                <div className="fp-actions">
                                  <button className="fp-btn accept" onClick={() => acceptFriendRequest(f.id)}>
                                    <UserCheck size={15} /> Accept
                                  </button>
                                  <button className="fp-btn decline" onClick={() => declineFriendRequest(f.id)}>
                                    <UserX size={15} /> Decline
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Outgoing requests */}
                      {outgoingRequests.length > 0 && (
                        <div className="fp-section">
                          <div className="fp-section-header">
                            <Clock size={16} /> Sent Requests
                            <span className="fp-count">{outgoingRequests.length}</span>
                          </div>
                          <div className="fp-cards-grid">
                            {outgoingRequests.map(f => (
                              <div key={f.id} className="fp-card outgoing">
                                <div className="fp-avatar">{f.receiverNickname[0].toUpperCase()}</div>
                                <div className="fp-info">
                                  <div className="fp-name">{f.receiverNickname}</div>
                                  <div className="fp-sub">Waiting for response...</div>
                                </div>
                                <div className="fp-actions">
                                  <span className="fp-pending-tag"><Clock size={12} /> Pending</span>
                                  <button className="fp-btn decline" onClick={() => cancelFriendRequest(f.id)} title="Cancel request">
                                    <X size={14} /> Cancel
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Accepted friends */}
                      <div className="fp-section">
                        <div className="fp-section-header">
                          <Heart size={16} /> Friends
                          <span className="fp-count">{friends.length}</span>
                        </div>
                        {friends.length === 0 ? (
                          <div className="fp-empty">
                            <Users size={48} />
                            <h3>No friends yet</h3>
                            <p>Start a chat and click <strong>Add Friend</strong> to connect!</p>
                          </div>
                        ) : (
                          <div className="fp-cards-grid">
                            {friends.map(f => {
                              const friendName = f.senderId === userId ? f.receiverNickname : f.senderNickname;
                              const friendId = f.senderId === userId ? f.receiverId : f.senderId;
                              const conv = dmConversations.find((c: any) => c.friendId === friendId);
                              const unreadCount = conv?.unreadCount || 0;
                              const lastMsg = conv?.lastMessage || null;
                              const lastMsgSenderIsMe = conv?.lastMessageSenderId === userId;
                              return (
                                <div key={f.id} className={`fp-card accepted ${unreadCount > 0 ? 'has-unread' : ''}`}
                                  onClick={() => startDmWithFriend(friendId, friendName)}>
                                  <div className="fp-avatar friend">
                                    {friendName[0].toUpperCase()}
                                    {unreadCount > 0 && (
                                      <span className="fp-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                                    )}
                                  </div>
                                  <div className="fp-info">
                                    <div className="fp-name">{friendName}</div>
                                    <div className={`fp-sub ${unreadCount > 0 ? 'has-unread' : ''}`}>
                                      {unreadCount > 0 ? `${unreadCount} new message${unreadCount > 1 ? 's' : ''}` : 'Friend'}
                                    </div>
                                    {lastMsg && (
                                      <div className={`fp-last-msg ${unreadCount > 0 ? 'unread' : ''}`}>
                                        {lastMsgSenderIsMe ? 'You: ' : ''}{lastMsg}
                                      </div>
                                    )}
                                  </div>
                                  <div className="fp-actions">
                                    <button className="fp-btn message" onClick={(e) => { e.stopPropagation(); startDmWithFriend(friendId, friendName); }} title="Send message">
                                      <MessageSquare size={14} /> Chat
                                    </button>
                                    <button className="fp-btn remove" onClick={(e) => { e.stopPropagation(); removeFriend(f.id); }} title="Remove friend">
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* DM CHAT */}
                  {appState === 'DM_CHAT' && dmFriendId && (
                    <motion.div key="dm-chat" className="dm-chat-view"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="dm-chat-header">
                        <button className="dm-back-btn" onClick={closeDmChat}>
                          <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} /> Back
                        </button>
                        <div className="dm-friend-info">
                          <div className="dm-friend-avatar">{dmFriendNickname[0]?.toUpperCase() || '?'}</div>
                          <div className="dm-friend-name"
                            style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--accent)' }}
                            onClick={async () => {
                              if (dmFriendId) {
                                setModal('stranger_profile');
                                try {
                                  const res = await fetch(`${API}/profile/${dmFriendId}`);
                                  if (res.ok) setStrangerProfile(await res.json());
                                  else setStrangerProfile({ userId: dmFriendId, nickname: dmFriendNickname, publicProfile: false });
                                } catch (e) {
                                  setStrangerProfile({ userId: dmFriendId, nickname: dmFriendNickname, publicProfile: false });
                                }
                              }
                            }}>{dmFriendNickname}</div>
                        </div>
                      </div>
                      <div className="dm-messages-list">
                        {dmMessages.length === 0 ? (
                          <div className="dm-empty">
                            <MessageSquare size={48} />
                            <h3>No messages yet</h3>
                            <p>Say hi to <strong>{dmFriendNickname}</strong>! Messages are saved and they'll see them when they come online.</p>
                          </div>
                        ) : (
                          dmMessages.map((msg: any, idx: number) => (
                            <div key={idx} className={`dm-msg ${msg.senderId === userId ? 'sent' : 'received'}`}>
                              <div className="dm-msg-bubble">
                                {msg.content && <span>{msg.content}</span>}
                                {msg.attachmentUrl && (
                                  <div className="dm-attachment">
                                    {msg.attachmentType?.startsWith('image') ? (
                                      <img src={msg.attachmentUrl} alt="media"
                                        className="dm-attach-img"
                                        onClick={() => { setPreviewImg(msg.attachmentUrl!); setModal('image_preview'); }} />
                                    ) : msg.attachmentType?.startsWith('video') ? (
                                      <video src={msg.attachmentUrl} controls className="dm-attach-video" />
                                    ) : (
                                      <a href={msg.attachmentUrl} target="_blank" rel="noreferrer" className="dm-attach-file">
                                        <Paperclip size={14} /> Attachment
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="dm-msg-time">
                                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </div>
                            </div>
                          ))
                        )}
                        <div ref={dmEndRef} />
                      </div>

                      {/* DM File preview chip */}
                      {dmSelectedFile && (
                        <div className="dm-file-preview">
                          {dmSelectedFile.type.startsWith('image') ? (
                            <img src={URL.createObjectURL(dmSelectedFile)} alt="preview" className="dm-file-thumb" />
                          ) : (
                            <Paperclip size={16} />
                          )}
                          <span className="dm-file-name">{dmSelectedFile.name}</span>
                          <span className="dm-file-size">({(dmSelectedFile.size / 1024).toFixed(0)} KB)</span>
                          <button className="dm-file-remove" onClick={() => setDmSelectedFile(null)}><X size={14} /></button>
                        </div>
                      )}

                      <div className="dm-input-bar">

                        <input id="dm-input" name="dmMessage" type="text" className="dm-input" value={dmInput}
                          aria-label="Direct message input"
                          onChange={e => setDmInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDmMessage(); } }}
                          placeholder={dmUploading ? 'Uploading...' : `Message ${dmFriendNickname}...`}
                          disabled={dmUploading} autoFocus />

                        <div style={{ display: 'flex', gap: '0.2rem', flexShrink: 0, alignItems: 'center' }}>
                          <label className={`dm-attach-btn auto-hide ${dmInput.length > 0 ? 'hidden' : ''}`} title="Attach media" htmlFor="dm-gallery-upload" style={{ cursor: dmUploading ? 'not-allowed' : 'pointer', margin: 0, opacity: dmUploading ? 0.35 : 1 }}>
                            <input id="dm-gallery-upload" name="dmGallery" type="file" style={{ display: 'none' }} accept="image/*,video/*" disabled={dmUploading}
                              onClick={(e) => {
                                const canSend = isAdmin || isPremium || isStrangerPremium || !localStorage.getItem('photo_sent');
                                if (!canSend) {
                                  e.preventDefault();
                                  setModal('upgrade');
                                }
                              }}
                              onChange={e => {
                                if (e.target.files?.[0]) setDmSelectedFile(e.target.files[0]);
                                e.target.value = '';
                              }} />
                            <ImageIcon size={18} />
                          </label>
                          <label className={`dm-attach-btn auto-hide ${dmInput.length > 0 ? 'hidden' : ''}`} title="Open Camera" htmlFor="dm-camera-upload" style={{ cursor: dmUploading ? 'not-allowed' : 'pointer', margin: 0, opacity: dmUploading ? 0.35 : 1 }}>
                            <input id="dm-camera-upload" name="dmCamera" type="file" style={{ display: 'none' }} accept="image/*" capture="environment" disabled={dmUploading}
                              onClick={(e) => {
                                const canSend = isAdmin || isPremium || isStrangerPremium || !localStorage.getItem('photo_sent');
                                if (!canSend) {
                                  e.preventDefault();
                                  setModal('upgrade');
                                }
                              }}
                              onChange={e => {
                                if (e.target.files?.[0]) setDmSelectedFile(e.target.files[0]);
                                e.target.value = '';
                              }} />
                            <Camera size={18} />
                          </label>
                          <div style={{ position: 'relative' }} className={`auto-hide ${dmInput.length > 0 ? 'hidden' : ''}`}>
                            <button type="button" className="dm-attach-btn" onClick={() => { setShowDmGifPicker(p => !p); setShowDmEmojiPicker(false); }} disabled={dmUploading} title="Send GIF">
                              <div style={{ fontSize: '11px', fontWeight: 'bold', lineHeight: '18px', width: '18px', textAlign: 'center' }}>GIF</div>
                            </button>
                            {showDmGifPicker && (
                              <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 24px)', height: '400px', boxShadow: '0 5px 30px rgba(0,0,0,0.7)', borderRadius: '12px', background: 'var(--bg-1)' }}>
                                <GifPicker
                                  onSelect={(url) => {
                                    const msg: any = { senderId: userId, receiverId: dmFriendId, content: '', senderNickname: profile?.nickname || userId, attachmentUrl: url, attachmentType: 'image/gif' };
                                    setDmMessages(prev => [...prev, { ...msg, type: 'CHAT', timestamp: new Date().toISOString() }]);
                                    fetch(`${API}/dm/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => { });
                                    setShowDmGifPicker(false);
                                  }}
                                  onClose={() => setShowDmGifPicker(false)}
                                />
                              </div>
                            )}
                          </div>
                          <div style={{ position: 'relative' }}>
                            <button className="dm-attach-btn" onClick={() => { setShowDmEmojiPicker(p => !p); setShowDmGifPicker(false); }} disabled={dmUploading}>
                              <Smile size={18} />
                            </button>
                            {showDmEmojiPicker && (
                              <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 24px)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 5px 30px rgba(0,0,0,0.7)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)' }}>Emoji</span>
                                  <button onClick={() => setShowDmEmojiPicker(false)} style={{ background: 'var(--bg-3)', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: '4px 6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
                                </div>
                                <EmojiPicker theme={"dark" as any} width={"100%"} height={340} onEmojiClick={(e) => { setDmInput(prev => prev + e.emoji); setShowDmEmojiPicker(false); }} />
                              </div>
                            )}
                          </div>
                        </div>

                        <button className="dm-send-btn" onClick={sendDmMessage}
                          disabled={(!dmInput.trim() && !dmSelectedFile) || dmUploading}>
                          <Send size={18} />
                        </button>
                      </div>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </main>
          </div>

          {/* ══ MOBILE BOTTOM NAV ══ */}
          <nav className="mobile-nav">
            <button className={`mobile-nav-btn ${appState === 'HOME' ? 'active' : ''}`} onClick={goHome}>
              <Activity size={20} />
              <span>Discover</span>
            </button>
            <button className={`mobile-nav-btn ${appState === 'FRIENDS' ? 'active' : ''}`}
              onClick={() => { setAppState('FRIENDS'); loadFriends(); loadDmConversations(); }}>
              <Users size={20} />
              <span>Friends</span>
              {incomingRequests.length > 0 && (
                <span className="mobile-nav-badge">{incomingRequests.length}</span>
              )}
            </button>
            <button className="mobile-nav-btn" onClick={() => setShowNotifications(s => !s)} style={{ position: 'relative' }}>
              <Bell size={20} />
              <span>Alerts</span>
              {(incomingRequests.length + dmUnreadTotal > 0) && (
                <span className="mobile-nav-badge">{incomingRequests.length + dmUnreadTotal}</span>
              )}
            </button>
            <button className="mobile-nav-btn" onClick={() => {
              setSettingsNickname(profile?.nickname || '');
              setSettingsCountry(profile?.country || '');
              setSettingsInterests(profile?.interests?.split(',').filter(Boolean) || []);
              setModal('settings');
            }}>
              <Settings size={20} />
              <span>Settings</span>
            </button>
            {isPremium ? (
              <button className="mobile-nav-btn" style={{ color: 'var(--accent)' }} onClick={() => { }}>
                <Crown size={20} />
                <span style={{ fontSize: '0.6rem' }}>Plus ✓</span>
              </button>
            ) : (
              <button className="mobile-nav-btn" onClick={() => setModal('upgrade')}>
                <Crown size={20} />
                <span style={{ fontSize: '0.6rem' }}>Upgrade</span>
              </button>
            )}
            {isAdmin && (
              <button className={`mobile-nav-btn ${appState === 'ADMIN' ? 'active' : ''}`}
                onClick={() => { setAppState('ADMIN'); loadAdminData(); loadAdminRooms(); }}>
                <Shield size={20} />
                <span style={{ fontSize: '0.6rem' }}>Admin</span>
              </button>
            )}

            {/* Mobile Dropdown rendering */}
            {showNotifications && (
              <div className="mobile-notifs" style={{ position: 'absolute', bottom: '60px', left: 0, right: 0, zIndex: 9999 }}>
                {renderNotifDropdown()}
              </div>
            )}
          </nav>

          {/* ══ MODALS ══ */}
          <AnimatePresence>

            {/* Settings */}
            {modal === 'settings' && (
              <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setModal('none')}>
                <motion.div className="modal" initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3><Settings size={18} /> Preferences</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>

                  <div className="modal-body">
                    {/* Avatar */}
                    <div className="avatar-section">
                      <div className="avatar-preview" onClick={() => avatarInputRef.current?.click()}>
                        {profile?.avatarUrl
                          ? <img src={profile.avatarUrl} alt="avatar" />
                          : <div className="avatar-placeholder">{(profile?.nickname || 'G')[0]}</div>}
                        <div className="avatar-overlay">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          <span>Change</span>
                        </div>
                      </div>
                    </div>

                    <label htmlFor="settings-nickname">Display Name</label>
                    <input id="settings-nickname" name="nickname" className="modal-input" type="text" value={settingsNickname}
                      maxLength={20}
                      onChange={e => setSettingsNickname(e.target.value)}
                      placeholder="Your nickname" />

                    <label htmlFor="settings-country">Country</label>
                    <input id="settings-country" name="country" className="modal-input" type="text" value={settingsCountry}
                      onChange={e => setSettingsCountry(e.target.value)} placeholder="e.g. India" />

                    <label>Interests</label>
                    <div className="interest-tags modal-interests">
                      {INTERESTS_OPTIONS.map(i => (
                        <button key={i} className={`tag ${settingsInterests.includes(i) ? 'active' : ''}`}
                          onClick={() => setSettingsInterests(prev =>
                            prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>
                          {i}
                        </button>
                      ))}
                    </div>

                    <div style={{ marginTop: '0.8rem', padding: '0.5rem', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                      <label htmlFor="settings-public-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input id="settings-public-profile" name="publicProfile" type="checkbox" checked={settingsPublicProfile} onChange={e => setSettingsPublicProfile(e.target.checked)} />
                        Allow others to view my Profile details (Privacy)
                      </label>
                    </div>

                    {isAuthenticated
                      ? <div className="auth-badge"><Check size={14} /> Signed in via Google</div>
                      : <button className="btn-google" onClick={handleGoogleLogin}>
                        <User size={16} /> Link Google Account
                      </button>
                    }
                  </div>

                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModal('none')}>Cancel</button>
                    <button className="btn-primary" onClick={saveProfile}>Save Changes</button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Report */}
            {modal === 'report' && (
              <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setModal('none')}>
                <motion.div className="modal" initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3><Flag size={18} /> Report Stranger</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>
                  <div className="modal-body">
                    <label htmlFor="report-reason">Reason</label>
                    <select id="report-reason" name="reportReason" className="modal-input" value={reportReason} onChange={e => setReportReason(e.target.value)}>
                      {REPORT_REASONS.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                    </select>
                    <label htmlFor="report-details">Additional Details</label>
                    <textarea id="report-details" name="reportDetails" className="modal-input" rows={3} value={reportDetails}
                      onChange={e => setReportDetails(e.target.value)} placeholder="Optional description..." />
                    <p className="warn-note"><AlertTriangle size={13} /> False reports may affect your account.</p>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModal('none')}>Cancel</button>
                    <button className="btn-danger" onClick={submitReport}>Submit Report</button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Confirm Skip */}
            {modal === 'confirm_skip' && (
              <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setModal('none')}>
                <motion.div className="modal modal-sm" initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Skip to Next?</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>
                  <div className="modal-body">
                    <p>This will end the current chat and find a new stranger.</p>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModal('none')}>Stay</button>
                    <button className="btn-primary" onClick={skipAndNext}>Skip & Continue</button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Upgrade Modal — Razorpay Checkout */}
            {modal === 'upgrade' && (
              <motion.div className="modal-overlay dark-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => { setModal('none'); setPaymentStep('features'); setPaymentError(''); }}>
                <motion.div className="modal" initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3><Crown size={18} /> Nova Plus</h3>
                    <button onClick={() => { setModal('none'); setPaymentStep('features'); setPaymentError(''); }}><X size={18} /></button>
                  </div>

                  <div className="modal-body" style={{ textAlign: 'center' }}>
                    {paymentStep === 'features' && (
                      <>
                        <div className="upgrade-features" style={{ textAlign: 'left', marginBottom: '1.5rem', background: 'var(--bg-2)', padding: '1rem', borderRadius: '12px' }}>
                          <div className="upgrade-feature" style={{ marginBottom: '0.8rem', alignItems: 'flex-start' }}><Check size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} /> <span><b>Unlimited Photos & Media</b></span></div>
                          <div className="upgrade-feature" style={{ marginBottom: '0.8rem', alignItems: 'flex-start' }}><Check size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} /> <span><b>Your chat partner also gets</b> to share media with you</span></div>
                          <div className="upgrade-feature" style={{ marginBottom: '0.8rem', alignItems: 'flex-start' }}><Check size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} /> <span><b>Priority Matching</b></span></div>
                          <div className="upgrade-feature" style={{ marginBottom: '0.8rem', alignItems: 'flex-start' }}><Check size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} /> <span><b>Premium Badge</b></span></div>
                          <div className="upgrade-feature" style={{ alignItems: 'flex-start' }}><Check size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: '2px' }} /> <span><b>No Ads</b> ever</span></div>
                        </div>
                        <div className="upgrade-price" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>₹299 <span style={{ fontSize: '1rem', color: 'var(--text-3)', fontWeight: 'normal' }}>/ lifetime</span></div>
                        <div style={{ color: 'var(--text-2)', fontSize: '0.85rem', marginBottom: '0.25rem' }}>One-time payment for lifetime access across the platform.</div>
                        <div style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>UPI · Cards · Net Banking · Wallets</div>
                      </>
                    )}

                    {paymentStep === 'processing' && (
                      <div style={{ padding: '3rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div className="payment-spinner" />
                        <div style={{ fontSize: '1rem', color: 'var(--text-2)' }}>Processing payment…</div>
                      </div>
                    )}

                    {paymentStep === 'success' && (
                      <div style={{ padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34, 197, 94, 0.15)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 30px rgba(34,197,94,0.2)' }}>
                          <Check size={32} />
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>Payment Successful! 🎉</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-2)' }}>Welcome to Nova Plus! Your premium features are now active.</div>
                      </div>
                    )}

                    {paymentStep === 'error' && (
                      <div style={{ padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <AlertTriangle size={32} />
                        </div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Payment Failed</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-2)' }}>{paymentError || 'Something went wrong. If money was deducted, it will be refunded automatically within 5-7 business days.'}</div>
                      </div>
                    )}
                  </div>

                  <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                    {paymentStep === 'features' && (
                      <>
                        <button className="btn-secondary" onClick={() => setModal('none')}>Cancel</button>
                        <button className="btn-premium-cta" onClick={async () => {
                          try {
                            setPaymentStep('processing');
                            // Load Razorpay SDK on demand
                            await loadRazorpay();
                            // Step 1: Create order on backend
                            const orderRes = await fetch(`${API}/payment/create-order`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId, nickname: profile?.nickname }),
                            });
                            if (!orderRes.ok) {
                              const err = await orderRes.json();
                              setPaymentError(err.error || 'Could not create order.');
                              setPaymentStep('error');
                              return;
                            }
                            const order = await orderRes.json();

                            // Step 2: Open Razorpay Checkout
                            const options = {
                              key: order.keyId,
                              amount: order.amount,
                              currency: order.currency,
                              name: 'NovaChat',
                              description: 'Nova Plus Premium — Lifetime',
                              order_id: order.orderId,
                              prefill: {
                                name: profile?.nickname || '',
                              },
                              theme: {
                                color: '#a855f7',
                                backdrop_color: 'rgba(0,0,0,0.8)',
                              },
                              modal: {
                                ondismiss: () => {
                                  setPaymentStep('features');
                                },
                              },
                              handler: async (response: any) => {
                                // Step 3: Verify payment on backend
                                try {
                                  setPaymentStep('processing');
                                  const verifyRes = await fetch(`${API}/payment/verify`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      razorpay_order_id: response.razorpay_order_id,
                                      razorpay_payment_id: response.razorpay_payment_id,
                                      razorpay_signature: response.razorpay_signature,
                                    }),
                                  });
                                  if (verifyRes.ok) {
                                    setIsPremium(true);
                                    setPaymentStep('success');
                                    showToast('🎉 Premium activated!', 'success');
                                    // Refresh profile
                                    if (userId) fetchProfile(userId);
                                  } else {
                                    const err = await verifyRes.json();
                                    setPaymentError(err.error || 'Verification failed.');
                                    setPaymentStep('error');
                                  }
                                } catch (_) {
                                  setPaymentError('Network error during verification. If payment was made, premium will be activated shortly.');
                                  setPaymentStep('error');
                                }
                              },
                            };

                            const rzp = new window.Razorpay(options);
                            rzp.on('payment.failed', (resp: any) => {
                              setPaymentError(resp.error?.description || 'Payment failed. Please try again.');
                              setPaymentStep('error');
                            });
                            rzp.open();
                            // Reset step since Razorpay UI is now handling it
                            setPaymentStep('features');

                          } catch (_) {
                            setPaymentError('Network error. Please check your connection.');
                            setPaymentStep('error');
                          }
                        }}>
                          Pay Now — ₹299
                        </button>
                      </>
                    )}
                    {paymentStep === 'success' && (
                      <button className="btn-primary" style={{ width: '100%' }} onClick={() => { setModal('none'); setPaymentStep('features'); }}>Awesome!</button>
                    )}
                    {paymentStep === 'error' && (
                      <>
                        <button className="btn-secondary" onClick={() => { setModal('none'); setPaymentStep('features'); setPaymentError(''); }}>Close</button>
                        <button className="btn-premium-cta" onClick={() => setPaymentStep('features')}>Try Again</button>
                      </>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Image Preview */}
            {modal === 'image_preview' && (
              <motion.div className="modal-overlay dark-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setModal('none')}>
                <motion.img src={previewImg} alt="preview" className="preview-img"
                  initial={{ scale: 0.8 }} animate={{ scale: 1 }} />
                <button className="close-preview" onClick={() => setModal('none')}><X size={24} /></button>
              </motion.div>
            )}

            {/* Add Friend Modal */}
            {modal === 'add_friend' && (
              <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setModal('none')}>
                <motion.div className="modal modal-sm" initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3><UserPlus size={18} /> Add Friend</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>
                  <div className="modal-body">
                    <div className="add-friend-avatar">
                      {strangerNickname[0].toUpperCase()}
                    </div>
                    <p className="add-friend-name">{strangerNickname}</p>
                    <p className="add-friend-desc">
                      Send <strong>{strangerNickname}</strong> a friend request to stay in touch after this chat ends.
                    </p>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModal('none')}>Cancel</button>
                    <button className="btn-primary" onClick={sendFriendRequest}>
                      <UserPlus size={15} /> Send Request
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Terms of Service Modal */}
            {modal === 'terms' && (
              <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal('none')}>
                <motion.div className="modal"
                  initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Terms of Service</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>
                  <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    <h4>1. Acceptance of Terms</h4>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: '1rem' }}>By using NovaChat, you agree to abide by these Terms of Service. If you do not agree, please do not use the app.</p>
                    <h4>2. Eligibility</h4>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: '1rem' }}>You must be 18 years or older to access NovaChat. By chatting, you consent that you meet this requirement.</p>
                    <h4>3. Prohibited Conduct</h4>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: '1rem' }}>You may not harass, spam, or share explicit material on this platform. Users found violating these rules will be banned.</p>
                    <h4>4. Data Privacy</h4>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: '1rem' }}>All chats are encrypted in transit. Content is temporarily stored for moderation but may be preserved if flagged for Terms of Service violations.</p>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-primary" style={{ width: '100%' }} onClick={() => setModal('none')}>I Understand</button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Stranger Profile Modal */}
            {modal === 'stranger_profile' && (
              <motion.div className="modal-overlay dark-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal('none')}>
                <motion.div className="modal" initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>{strangerProfile?.nickname || 'Profile'}</h3>
                    <button onClick={() => setModal('none')}><X size={18} /></button>
                  </div>
                  <div className="modal-body" style={{ textAlign: 'center' }}>

                    <div className="user-avatar-wrap" style={{ margin: '0 auto 1rem', width: '80px', height: '80px', fontSize: '2rem' }}>
                      {strangerProfile?.avatarUrl ? (
                        <img src={strangerProfile.avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div className="user-avatar-placeholder" style={{ width: '100%', height: '100%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {(strangerProfile?.nickname || 'G')[0].toUpperCase()}
                        </div>
                      )}
                    </div>

                    {strangerProfile?.publicProfile === false ? (
                      <div className="text-muted" style={{ padding: '2rem 1rem' }}>
                        🔒 {strangerProfile.nickname} has set their profile to Private.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', textAlign: 'left', background: 'var(--bg-2)', padding: '1rem', borderRadius: '12px' }}>
                        <div><strong style={{ color: 'var(--text-3)' }}>Country:</strong> {strangerProfile?.country || 'Not specified'}</div>
                        <div><strong style={{ color: 'var(--text-3)' }}>Gender:</strong> {strangerProfile?.gender || 'Not specified'}</div>
                        <div><strong style={{ color: 'var(--text-3)' }}>Reputation:</strong> +{strangerProfile?.reputationScore ?? 100}XP</div>
                        <div>
                          <strong style={{ color: 'var(--text-3)' }}>Interests:</strong>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
                            {strangerProfile?.interests ? strangerProfile.interests.split(',').filter(Boolean).map(i => (
                              <span key={i} className="chip" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', border: '1px solid rgba(255,255,255,0.1)' }}>{i}</span>
                            )) : <span className="text-muted">No interests listed</span>}
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModal('none')}>Close</button>
                    {(appState === 'CHATTING' && userId && strangerUserId && friendStatus === 'NONE') && (
                      <button className="btn-primary" onClick={() => { setModal('add_friend'); }}><UserPlus size={15} /> Add Friend</button>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Toast */}
            {toast && (
              <motion.div className={`toast toast-${toast.type}`}
                initial={{ opacity: 0, y: 60, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 40, x: '-50%' }}>
                <Bell size={15} /> {toast.msg}
              </motion.div>
            )}

          </AnimatePresence>
        </>
      )
      }
    </div >
  );
}
