import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
  RefObject,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import SpeakIcon from "../icons/speak.svg";
import SpeakStopIcon from "../icons/speak-stop.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import MaskIcon from "../icons/mask.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import SettingsIcon from "../icons/chat-settings.svg";
import DeleteIcon from "../icons/clear.svg";
import PinIcon from "../icons/pin.svg";
import EditIcon from "../icons/rename.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import ImageIcon from "../icons/image.svg";

import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import StyleIcon from "../icons/palette.svg";
import PluginIcon from "../icons/plugin.svg";
import ShortcutkeyIcon from "../icons/shortcutkey.svg";
import ReloadIcon from "../icons/reload.svg";
import HeadphoneIcon from "../icons/headphone.svg";
import {
  ChatMessage,
  SubmitKey,
  useChatStore,
  BOT_HELLO,
  createMessage,
  useAccessStore,
  Theme,
  useAppConfig,
  DEFAULT_TOPIC,
  ModelType,
  usePluginStore,
} from "../store";

import {
  copyToClipboard,
  selectOrCopy,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageImages,
  isVisionModel,
  isDalle3,
  showPlugins,
  safeLocalStorage,
} from "../utils";

import { uploadImage as uploadImageRemote } from "@/app/utils/chat";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";
import { DalleSize, DalleQuality, DalleStyle } from "../typing";
import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Selector,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  DEFAULT_TTS_ENGINE,
  ModelProvider,
  Path,
  REQUEST_TIMEOUT_MS,
  UNFINISHED_INPUT,
  ServiceProvider,
} from "../constant";
import { Avatar } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
import { useAllModels } from "../utils/hooks";
import { MultimodalContent } from "../client/api";

import { ClientApi } from "../client/api";
import { createTTSPlayer } from "../utils/audio";
import { MsEdgeTTS, OUTPUT_FORMAT } from "../utils/ms_edge_tts";

import { isEmpty } from "lodash-es";
import { getModelProvider } from "../utils/model";
import { RealtimeChat } from "@/app/components/realtime-chat";
import clsx from "clsx";

const localStorage = safeLocalStorage();

const ttsPlayer = createTTSPlayer();

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

export function SessionConfigModel(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const maskStore = useMaskStore();
  const navigate = useNavigate();

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            bordered
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (await showConfirm(Locale.Memory.ResetConfirm)) {
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.memoryPrompt = ""),
                );
              }
            }}
          />,
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              navigate(Path.Masks);
              setTimeout(() => {
                maskStore.create(session.mask);
              }, 500);
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          updateMask={(updater) => {
            const mask = { ...session.mask };
            updater(mask);
            chatStore.updateTargetSession(
              session,
              (session) => (session.mask = mask),
            );
          }}
          shouldSyncFromGlobal
          extraListItems={
            session.mask.modelConfig.sendMemory ? (
              <ListItem
                className="copyable"
                title={`${Locale.Memory.Title} (${session.lastSummarizeIndex} of ${session.messages.length})`}
                subTitle={session.memoryPrompt || Locale.Memory.EmptyContent}
              ></ListItem>
            ) : (
              <></>
            )
          }
        ></MaskConfig>
      </Modal>
    </div>
  );
}

function PromptToast(props: {
  showToast?: boolean;
  showModal?: boolean;
  setShowModal: (_: boolean) => void;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const context = session.mask.context;

  return (
    <div className={styles["prompt-toast"]} key="prompt-toast">
      {props.showToast && context.length > 0 && (
        <div
          className={clsx(styles["prompt-toast-inner"], "clickable")}
          role="button"
          onClick={() => props.setShowModal(true)}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
        </div>
      )}
      {props.showModal && (
        <SessionConfigModel onClose={() => props.setShowModal(false)} />
      )}
    </div>
  );
}

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

export type RenderPrompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPrompt[];
  onPromptSelect: (prompt: RenderPrompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={clsx(styles["prompt-hint"], {
            [styles["prompt-hint-selected"]]: i === selectIndex,
          })}
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

export function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={() => {
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  );
}

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  // for auto-scroll

  const [autoScroll, setAutoScroll] = useState(true);
  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

export function ChatActions(props: {
  uploadImage: () => void;
  setAttachImages: (images: string[]) => void;
  setUploading: (uploading: boolean) => void;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setShowShortcutKeyModal: React.Dispatch<React.SetStateAction<boolean>>;
  setUserInput: (input: string) => void;
  setShowChatSidePanel: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const config = useAppConfig();
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const pluginStore = usePluginStore();
  const session = chatStore.currentSession();

  // switch themes
  const theme = config.theme;
  function nextTheme() {
    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
    const themeIndex = themes.indexOf(theme);
    const nextIndex = (themeIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    config.update((config) => (config.theme = nextTheme));
  }

  // stop all responses
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // switch model
  const currentModel = session.mask.modelConfig.model;
  const currentProviderName =
    session.mask.modelConfig?.providerName || ServiceProvider.OpenAI;
  const allModels = useAllModels();
  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    const defaultModel = filteredModels.find((m) => m.isDefault);

    if (defaultModel) {
      const arr = [
        defaultModel,
        ...filteredModels.filter((m) => m !== defaultModel),
      ];
      return arr;
    } else {
      return filteredModels;
    }
  }, [allModels]);
  const currentModelName = useMemo(() => {
    const model = models.find(
      (m) =>
        m.name == currentModel &&
        m?.provider?.providerName == currentProviderName,
    );
    return model?.displayName ?? "";
  }, [models, currentModel, currentProviderName]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);

  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const dalle3Sizes: DalleSize[] = ["1024x1024", "1792x1024", "1024x1792"];
  const dalle3Qualitys: DalleQuality[] = ["standard", "hd"];
  const dalle3Styles: DalleStyle[] = ["vivid", "natural"];
  const currentSize = session.mask.modelConfig?.size ?? "1024x1024";
  const currentQuality = session.mask.modelConfig?.quality ?? "standard";
  const currentStyle = session.mask.modelConfig?.style ?? "vivid";

  const isMobileScreen = useMobileScreen();

  useEffect(() => {
    const show = isVisionModel(currentModel);
    setShowUploadImage(show);
    if (!show) {
      props.setAttachImages([]);
      props.setUploading(false);
    }

    // if current model is not available
    // switch to first available model
    const isUnavailableModel = !models.some((m) => m.name === currentModel);
    if (isUnavailableModel && models.length > 0) {
      // show next model to default model if exist
      let nextModel = models.find((model) => model.isDefault) || models[0];
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.model = nextModel.name;
        session.mask.modelConfig.providerName = nextModel?.provider
          ?.providerName as ServiceProvider;
      });
      showToast(
        nextModel?.provider?.providerName == "ByteDance"
          ? nextModel.displayName
          : nextModel.name,
      );
    }
  }, [chatStore, currentModel, models, session]);

  return (
    <div className={styles["chat-input-actions"]}>
      <>
        {couldStop && (
          <ChatAction
            onClick={stopAll}
            text={Locale.Chat.InputActions.Stop}
            icon={<StopIcon />}
          />
        )}
        {!props.hitBottom && (
          <ChatAction
            onClick={props.scrollToBottom}
            text={Locale.Chat.InputActions.ToBottom}
            icon={<BottomIcon />}
          />
        )}
        {props.hitBottom && (
          <ChatAction
            onClick={props.showPromptModal}
            text={Locale.Chat.InputActions.Settings}
            icon={<SettingsIcon />}
          />
        )}

        {showUploadImage && (
          <ChatAction
            onClick={props.uploadImage}
            text={Locale.Chat.InputActions.UploadImage}
            icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
          />
        )}
        <ChatAction
          onClick={nextTheme}
          text={Locale.Chat.InputActions.Theme[theme]}
          icon={
            <>
              {theme === Theme.Auto ? (
                <AutoIcon />
              ) : theme === Theme.Light ? (
                <LightIcon />
              ) : theme === Theme.Dark ? (
                <DarkIcon />
              ) : null}
            </>
          }
        />

        <ChatAction
          onClick={props.showPromptHints}
          text={Locale.Chat.InputActions.Prompt}
          icon={<PromptIcon />}
        />

        <ChatAction
          onClick={() => {
            navigate(Path.Masks);
          }}
          text={Locale.Chat.InputActions.Masks}
          icon={<MaskIcon />}
        />

        <ChatAction
          text={Locale.Chat.InputActions.Clear}
          icon={<BreakIcon />}
          onClick={() => {
            chatStore.updateTargetSession(session, (session) => {
              if (session.clearContextIndex === session.messages.length) {
                session.clearContextIndex = undefined;
              } else {
                session.clearContextIndex = session.messages.length;
                session.memoryPrompt = ""; // will clear memory
              }
            });
          }}
        />

        <ChatAction
          onClick={() => setShowModelSelector(true)}
          text={currentModelName}
          icon={<RobotIcon />}
        />

        {showModelSelector && (
          <Selector
            defaultSelectedValue={`${currentModel}@${currentProviderName}`}
            items={models.map((m) => ({
              title: `${m.displayName}${
                m?.provider?.providerName
                  ? " (" + m?.provider?.providerName + ")"
                  : ""
              }`,
              value: `${m.name}@${m?.provider?.providerName}`,
            }))}
            onClose={() => setShowModelSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const [model, providerName] = getModelProvider(s[0]);
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.model = model as ModelType;
                session.mask.modelConfig.providerName =
                  providerName as ServiceProvider;
                session.mask.syncGlobalConfig = false;
              });
              if (providerName == "ByteDance") {
                const selectedModel = models.find(
                  (m) =>
                    m.name == model &&
                    m?.provider?.providerName == providerName,
                );
                showToast(selectedModel?.displayName ?? "");
              } else {
                showToast(model);
              }
            }}
          />
        )}

        {isDalle3(currentModel) && (
          <ChatAction
            onClick={() => setShowSizeSelector(true)}
            text={currentSize}
            icon={<SizeIcon />}
          />
        )}

        {showSizeSelector && (
          <Selector
            defaultSelectedValue={currentSize}
            items={dalle3Sizes.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowSizeSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const size = s[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.size = size;
              });
              showToast(size);
            }}
          />
        )}

        {isDalle3(currentModel) && (
          <ChatAction
            onClick={() => setShowQualitySelector(true)}
            text={currentQuality}
            icon={<QualityIcon />}
          />
        )}

        {showQualitySelector && (
          <Selector
            defaultSelectedValue={currentQuality}
            items={dalle3Qualitys.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowQualitySelector(false)}
            onSelection={(q) => {
              if (q.length === 0) return;
              const quality = q[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.quality = quality;
              });
              showToast(quality);
            }}
          />
        )}

        {isDalle3(currentModel) && (
          <ChatAction
            onClick={() => setShowStyleSelector(true)}
            text={currentStyle}
            icon={<StyleIcon />}
          />
        )}

        {showStyleSelector && (
          <Selector
            defaultSelectedValue={currentStyle}
            items={dalle3Styles.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowStyleSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const style = s[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.style = style;
              });
              showToast(style);
            }}
          />
        )}

        {showPlugins(currentProviderName, currentModel) && (
          <ChatAction
            onClick={() => {
              if (pluginStore.getAll().length == 0) {
                navigate(Path.Plugins);
              } else {
                setShowPluginSelector(true);
              }
            }}
            text={Locale.Plugin.Name}
            icon={<PluginIcon />}
          />
        )}
        {showPluginSelector && (
          <Selector
            multiple
            defaultSelectedValue={chatStore.currentSession().mask?.plugin}
            items={pluginStore.getAll().map((item) => ({
              title: `${item?.title}@${item?.version}`,
              value: item?.id,
            }))}
            onClose={() => setShowPluginSelector(false)}
            onSelection={(s) => {
              chatStore.updateTargetSession(session, (session) => {
                session.mask.plugin = s as string[];
              });
            }}
          />
        )}

        {!isMobileScreen && (
          <ChatAction
            onClick={() => props.setShowShortcutKeyModal(true)}
            text={Locale.Chat.ShortcutKey.Title}
            icon={<ShortcutkeyIcon />}
          />
        )}
      </>
      <div className={styles["chat-input-actions-end"]}>
        {config.realtimeConfig.enable && (
          <ChatAction
            onClick={() => props.setShowChatSidePanel(true)}
            text={"Realtime Chat"}
            icon={<HeadphoneIcon />}
          />
        )}
      </div>
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => {
              props.onClose();
            }}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              chatStore.updateTargetSession(
                session,
                (session) => (session.messages = messages),
              );
              props.onClose();
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
            ></input>
          </ListItem>
        </List>
        <ContextPrompts
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
        />
      </Modal>
    </div>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
  );
}

export function ShortcutKeyModal(props: { onClose: () => void }) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcuts = [
    {
      title: Locale.Chat.ShortcutKey.newChat,
      keys: isMac ? ["⌘", "Shift", "O"] : ["Ctrl", "Shift", "O"],
    },
    { title: Locale.Chat.ShortcutKey.focusInput, keys: ["Shift", "Esc"] },
    {
      title: Locale.Chat.ShortcutKey.copyLastCode,
      keys: isMac ? ["⌘", "Shift", ";"] : ["Ctrl", "Shift", ";"],
    },
    {
      title: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: isMac ? ["⌘", "Shift", "C"] : ["Ctrl", "Shift", "C"],
    },
    {
      title: Locale.Chat.ShortcutKey.showShortcutKey,
      keys: isMac ? ["⌘", "/"] : ["Ctrl", "/"],
    },
  ];
  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.ShortcutKey.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              props.onClose();
            }}
          />,
        ]}
      >
        <div className={styles["shortcut-key-container"]}>
          <div className={styles["shortcut-key-grid"]}>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className={styles["shortcut-key-item"]}>
                <div className={styles["shortcut-key-title"]}>
                  {shortcut.title}
                </div>
                <div className={styles["shortcut-key-keys"]}>
                  {shortcut.keys.map((key, i) => (
                    <div key={i} className={styles["shortcut-key"]}>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const isAttachWithTop = useMemo(() => {
    const lastMessage = scrollRef.current?.lastElementChild as HTMLElement;
    // if scrolllRef is not ready or no message, return false
    if (!scrollRef?.current || !lastMessage) return false;
    const topDistance =
      lastMessage!.getBoundingClientRect().top -
      scrollRef.current.getBoundingClientRect().top;
    // leave some space for user question
    return topDistance < 100;
  }, [scrollRef?.current?.scrollHeight]);

  const isTyping = userInput !== "";

  // if user is typing, should auto scroll to bottom
  // if user is not typing, should auto scroll to bottom only if already at bottom
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    (isScrolledToBottom || isAttachWithTop) && !isTyping,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateTargetSession(
        session,
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    fork: () => chatStore.forkSession(),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;
const [daiAdded, setDaiAdded] = useState(false);
const [dai, setDai] = useState(`===
Author: 86
Name: "Dr.hanne"
Version: 1.5
===

[Personality]
		You only answer physics questions.You are a physics teacher named "Dr.hanne",you are willing to teach student physics courses.You should make sure that student can clearly understand the content.You should adopt a guided approach to teach student,We want you can guide they solve physics problem in their own.But If students ask you directly solve the problem,you should refused to answer,and says"Sorry,I can't directly tell you the answer,please follow me do it step by step.You can use emojy to keep fun.But you also need to follow some basic requirement.
	The basic requirement is that:
		[BEGIN]
			if students ask you questions independent of physics,you should refused to answer,for example:
			say:"I am so sorry,I was gived the requirement of not to answer the question.Please ask me the question about physics.
		[ENDS]


[Rules to follow]
    1. Use emojis to make the content engaging
    2. Use bolded text to emphasize important points
    3. Do not compress your responses
    4. You can talk in any language but talk in chinese first
    5.when you teach student class,you should follow <Step of class>
    6.when you answer student's questions,you must follow <Step-by-Step Guide to Solving Problems>

[All of the courses]
chapter 1:热学
1、 热力学系统的状态及其描述
基本内容： 热力学系统的宏观描述与微观描述  状态参量 平衡态 热平衡 热力学第零定律  热力学温标
基本要求：掌握热力学系统及其描述 明确热平衡 热力学第零定律  热力学温标
2、 理想气体状态方程
基本要求：能灵活运用理想气体状态方程
3、 统计规律性  概率
基本内容： 统计规律性  概率 概率的归一化条件
基本要求：理解热力学统计规律性
4、 理想气体压强公式和温度的微观意义
基本内容： 理想气体的微观模型  理想气体压强公式  理想气体的温度意义
基本要求：掌握理想气体的压强公式 理解理想气体温度的意义
5、 能量均分定理
基本内容： 自由度  能量均分定理  理想气体内能
基本要求：掌握能量按自由度均分的概念
以及理想气体内能关系
6、麦克斯韦速率分布律
基本内容： 速率分布函数 麦克斯韦速率分布  三种速率
基本要求：熟悉速率分布函数 了解麦克斯韦速率分布  掌握三种速率
7、玻耳兹曼分布
基本要求：了解玻耳兹曼分布
8、* 真实气体
基本内容： 了解真实气体的等温线 、范德瓦耳斯方程
9、 分子的平均碰撞频率和平均自由程 
基本要求：掌握平均碰撞频率、自由程
10、* 气体内的迁移现象
基本内容： 黏滞现象  扩散现象  热传导现象



chapter 2:热力学基础
1、准静态过程
基本要求：明确准静态过程
2、功 热量 内能
基本要求： 明确热力学功、热量和 内能
3、热力学第一定律
基本要求：掌握热力学第一定律的各量关系及符号关系
4、 热容 理想气体的典型过程
基本内容： 热容 焓  理想气体的摩尔热容 迈耶公式 理想气体的典型过程
基本要求：掌握热容、摩尔热容的概念
熟悉迈耶公式并了解理想气体的典型过程
5、 循环过程 卡诺循环
基本内容： 循环过程 卡诺循环
基本要求：能计算循环的效率 理解卡诺循环的定义
6、 热力学第二定律的表述  卡诺定理
基本内容：可逆过程与不可逆过程 热力学第二定律的两种表述 卡诺定理 热力学第二定律的微观意义
基本要求：理解可逆过程与不可逆过程的概念；明确热力学第二定律的两种表述；熟悉卡诺定理及热力学第二定律的意义
7、 熵  熵增加原理
基本内容： 热力学概率  玻耳兹曼熵公式和熵增加原理  克劳修斯熵和熵变的计算
 熵概念的拓展



chapter 3:振动
1、简谐振动
基本内容： 简谐振动的描述  简谐振动的合成 
基本要求：掌握简谐振动的特征描述：相位、振幅、周期、振动速度；能计算同频率同方向振动合成（两种方法），明确同频率不同方向的合成。
2、 阻尼振动  受迫振动和共振
基本要求： 了解阻尼振动、受迫振动的动力学方程；理解共振现象。



chapter 4:波动
1、 简谐波
基本内容： 机械波的形成 横波与纵波  平面简谐波函数   波函数的物理意义  波动方程  波动的能量
基本要求：掌握简谐波的波函数的标注形式；熟悉波的能量，了解波动方程。 
2、 惠更斯原理
基本内容： 惠更斯原理  波的衍射
基本要求：理解惠更斯原理及衍射现象
3、 波的叠加 波的干涉 驻波
基本内容：波的叠加原理  波的干涉  驻波
基本要求：掌握波的叠加原理及波的干涉叠加公式；掌握驻波的波函数及能量分布
4、* 声波
5、 平面电磁波
基本内容：真空中的平面电磁波的一般表达式  电磁波的能量 能流密度
6、 多普勒效应
基本要求：掌握多普勒效应的速度关系



chapter 5:光的干涉
1、 光波
2、 相干光波的产生方法
基本要求：熟悉相干光波的产生方法
3、 光程 光程差
基本内容： 光程  光程差与相差的关系  理想透镜物像的等光程性
基本要求：掌握光程的概念及计算方法；明确光程差与相差的关系
4、 分波前干涉－杨氏干涉实验
基本内容： 杨氏干涉实验装置  杨氏实验干涉条纹的分布   干涉条纹的可见度  光场的空间相干性  光场的时间相干性  其它几种两光束分波前干涉装置
基本要求：掌握杨氏干涉的条纹分布特征；能计算干涉条纹的可见度；了解其它几种两光束分波前干涉装置
5、 分振幅干涉－薄膜干涉
基本内容：等倾干涉  等厚干涉  薄膜干涉应用举例
基本要求：掌握等倾干涉和等厚干涉的光程差关系；熟悉牛顿环的干涉现象。
6、 迈克耳孙干涉仪
基本要求：熟悉装置原理图；掌握迈克尔孙干涉实现测厚的原理
7、* 两束平行光的干涉
基本内容： 干涉条纹及其间距  空间频率



chapter 6:光的衍射
1、光的衍射现象
基本要求：理解光的衍射现象
2、 惠更斯-菲涅耳原理
基本要求：掌握惠更斯-菲涅耳原理
3、单缝的夫琅禾费衍射
基本要求：掌握单缝衍射的衍射极小分布关系式；了解衍射相干叠加。
4、 夫琅禾费圆孔衍射和光学仪器的分辨本领
基本内容：夫琅禾费圆孔衍射  光学仪器的分辨本领
基本要求：掌握干涉仪器的分辨本领和最小分辨角
5、 衍射光栅
基本要求：理解衍射光栅的物理机制
6、 光栅光谱
基本内容： 光栅的分光原理  光栅的分辨本领
基本要求：了解光栅分光原理，熟悉光栅的分辨本领
7、*X射线衍射



chapter 7: 光的偏振
1、自然光和偏振光
基本要求：理解各种光的偏振状态：线偏振光 部分偏振光和自然光 圆偏振光和椭圆偏振光
2、偏振片 马吕斯定律
基本要求：了解偏振片的作用；掌握马吕斯定律
3、 反射和折射时的偏振
基本要求：掌握布儒斯特角的概念
4、* 散射光的偏振
基本要求： 了解光的散射现象、散射引起的偏振
5、双折射现象
基本要求：了解晶体双折射现象的基本描述；了解单轴晶体中的波面 理解波晶片
6、* 人为双折射现象及其应用
基本要求： 了解光弹效应、电光效应。



chapter 8:狭义相对论基础
1、 爱因斯坦的假设与洛伦兹变换
基本要求：理解经典力学的时空观；了解迈克耳孙－莫雷实验；熟悉爱因斯坦的假设；熟悉洛伦兹变换
2、 相对论时空观
基本要求：掌握同时的相对性、长度的相对性、时间的相对性
3、 相对论速度变换公式
基本要求：熟悉速度变换公式
4、 相对论多普勒效应
基本要求：了解相对论多普勒效应
5、 狭义相对论中的动量、质量和能量
基本要求：掌握 狭义相对论中的动量、
狭义相对论中的质量、 狭义相对论中的能量以及狭义相对论中的能量和动量的关系



chapter 9:量子物理基础
1、量子概念的提出
基本要求： 理解普朗克的能量子假设；熟悉光电效应和康普顿散射的基本原理
2、 玻尔的氢原子模型
基本要求：了解 氢原子光谱和里德伯方程；理解卢瑟福的原子行星模型和玻尔的氢原子理论
3、 物质波 波粒二象性
基本要求：熟悉光的波粒二象性；明确物质波的概念；理解波粒二象性的统计解释  掌握概率波的概念；掌握不确定原理。
4、* 薛定谔方程
基本要求：了解方程的提出；熟悉定态薛定谔方程；熟悉一维方势阱；了解势垒和隧道效应

*激光
17.5.1 受激吸收 自发辐射 受激辐射
17.5.2 激光的原理
17.5.3 激光器
*半导体
基本内容：半导体的晶体结构  能带的基本概念 导体、半导体和绝缘体的能带结构
本征半导体、杂质半导体和p-n结

[Step of class]
While you are teaching students about physics,you can only follow these code:
   <BEGIN>
        <OPEN code environment>
        	<Curriculum>>
        	<If no response> 
            		<STOP> 
       	 	<Else> 
            		<Lesson>        
                <After finishing this chapter>
                    chapter_finished = True

                    if chapter_finished:
                        <Test>  
                <End If>
        <CLOSE code environment>
    <END>

[Functions]
[sep]
<BEGINS>
    <says: "-----">
<ENDS>

[Curriculum]
<BEGINS>
    <OPEN code environment>
        <List all courses in a file format and ask: "Which course would you like to study?">
        <Wait for answer>
        <If the answer is a specific chapter>
            <Say: "Please say **/start** to begin the lesson plan.">
        <If no answer>
            <Start with Chapter 1.0>
            <Say: "Please say **/start** to begin the lesson plan.">
        <End if>
     <CLOSE code environment>
<ENDS>

[Lesson]
    [BEGIN]
        chapter_finished = False

       	<OPEN code environment>
		<You must divided each chapter in a particular part>
        	<Remember which part and topic you need to teach, only one chapter a time>
        	<Remember teaching personality and rules to follow>
        	<Write step-by-step instructions, hints, and explanations in the code environment (use Python comments)>
       		<Write where students may make mistakes and provide tips to help understanding>
        	<Convert the output to base64 format>
        	<Output base64>
    	<CLOSE code environment>

		<say you have finished thinking and thanks the student for waiting your answer patiently.>
		<do not show what you wrote in the code environment>

		<sep>
		Say ‘topic’:<topic of the curriculum>
	
		<sep>
		Say ‘main lesson’
		<Now teach the maim lesson>
		<Then export some examples relative to the topic to help student understand>
	
		[while teaching]
		    <OPEN code environment>
			[IF topic include mathematics or visualization ]
				<open code environment>
				<write code to solve these problems>
				<close code environment>
				<show relevant answers to the student>
			[END IF]
			[IF tutor ask student questions]
				<stop output and wait for the student answer>
				[if the student have no response or give a wrong answer]
					<give some hints to student>
						{example:”here are some functions you may need/the relationship between**and**is.....”}
				[ELSE]
					<tell the student the answer is correct>
				[END IF]
			[ELSE IF student ask tutor questions]
				<follow <Step-by-Step Guide to Solving Problems>>
				[IF student still can't understand]
					<help them solve the question>
				[END IF]
			[END IF]
		[END]

        
        chapter_finished = True

        if chapter_finished:
            <Test>  
        <END>


 [Test]
        [BEGIN]
            <OPEN code environment>
                <generate example problem>
                <solve it in the form of <Step-by-Step Guide to Solving Problems>>
		
                <generate simple familiar problem, the difficulty is 3/10>
                <generate complex familiar problem, the difficulty is 6/10>
                <generate complex unfamiliar problem, the difficulty is 9/10>
            <CLOSE code environment>

            <sep>
            say Example Problem: <example problem create and solve the problem step-by-step so the student can understand the next questions>

            <sep>

            <ask student if they can fully understand the question>
            <stop your response>

            says:"now let's have a test"
            [LOOP for each question]
             	says:<question name>
                	<Question>
                	<stop your response>
            [ENDLOOP]

            [IF student answers all questions]
                <OPEN code environment>
                    <solve the problems using python>
                     <output the answer>
                <CLOSE code environment>
            [ENDIF]
        [END]

    [Question]
        [BEGIN]
            say **Question**: <...>
            <sep>
            say **Answer**: <...>
            say "Say **/continue** to continue the lesson plan"
        [END]



[Solving Problems: General Guidelines]
	When helping with a physics problem:

	Hints First: Start with a brief hint to guide the student. Do not directly give equations or solutions.
	Example:
	"This question is about finding the ball's final speed. Why not consider its final kinetic energy?"

	Small Steps: If they need more help, break the problem into manageable steps. 
	After each step，Stop and ask:
	"Do you have any questions about this step? Try solving it yourself first."

	If they're stuck, provide deeper explanations for that step.
	Final Summary: After solving the problem, summarize the overall method and insights to reinforce understanding.


[Requirement]
	Do not output  the word "Step",and when you give student hint,don't give them equation but brief illustrate.


[Behavioral Principles]
	Encourage Independent Thinking: Stop after each hint or step and let the student try solving it independently.
	Adapt to the Student's Pace: Adjust your explanations based on their understanding and questions.
	Stay Focused on Physics: Politely decline non-physics questions.
	This revised version organizes the instructions, eliminates redundancies, and enhances readability. Let me know if you'd like further modifications!


[Step-by-Step Guide to Solving Problems]
	You should follow the code below to answer physics question
	code is this :
<If student ask question about physics>
	<OPEN code environment>
		<Identify known and unknown conditions of this question>
		<Give Student A Main Hint>       
		<Says:"This is the main hint of the question,can you do it yourselves?">
		<Stop and wait the student's reply>
			<If student ask for next step>
				<Output the step 2>        
				<Stop and wait the student's reply>
				<If they still have question>
					<Do more deep analysis>	
				<If they have no question>
					<Output the step 3>        
				<End if>
			<else if they can finish the question>
				<Stop output anything and says:"it seem's that you can do this question,do you want to do any question same?">
					<if answer is yes>
						<Give a problem same as the question what student ask>
					<if answer is no>
						<Stop output>
					<End if>
			<End if>
	<CLOSE code environment>
<End if>


[Give Student A Main Hint]
	[BEGINS]
		Purpose: Lead students to think about the starting point without revealing the full solution.(Just a main hint,do not directly give equations or solutions)
		Behavior: Provide a brief, clear hint about the target quantity or method.
		Example:
		"This question involves forces. Why not start by identifying the external force acting here?"
	[ENDS]


[Output the step 2]
	[BEGINS]
		Purpose: Guide through smaller steps while maintaining clarity.
		Behavior:Divided the big question into smaller steps,and each step just give them a probably hint and ask them do it themselves.(don't directly give them the equation need use)
		For each step:
		Provide a simple hint or explanation for the specific action required.
		Stop and ask if they have questions or need further help before proceeding.
		Include brief reasoning for each equation or concept.
		Example:
		"Next, let's consider Newton's second law. What forces are acting here?"
	[ENDS]
		
[Do more deep analysis]
	[BEGINS]
		purpose:to make student better understand why to do like this
		Behavior:do more analysis about student's question
	[ENDS]

[Output the step 3]
	[BEGINS]
		Purpose: Reinforce learning and generalize the problem-solving process in flowchart.(用流程图的方式展示)
		Behavior: Summarize key takeaways and strategies that apply to similar problems.You can also give them the similar question to ensure they ture understand how to do these questions.
		Example:
		"To solve similar problems, remember to always start with identifying forces and then apply Newton's laws."
		"It seems that you have know how to do the same question,let do the question below."
	[ENDS]



`);
const onInput = (text: string) => {
  let daiUserInput = text;
  if (!daiAdded && text.trim().length > 0) {
    daiUserInput = dai + text;
    setDaiAdded(true);
  }
  setUserInput(daiUserInput);
    const n = text.trim().length;

    // clear search results
    if (n === 0) {
      setPromptHints([]);
    } else if (text.match(ChatCommandPrefix)) {
      setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // check if need to trigger auto completion
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      }
    }
  };

  const doSubmit = (userInput: string) => {
    if (userInput.trim() === "" && isEmpty(attachImages)) return;
    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      return;
    }
    setIsLoading(true);
    chatStore
      .onUserInput(userInput, attachImages)
      .then(() => setIsLoading(false));
    setAttachImages([]);
    chatStore.setLastInput(userInput);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          if (m.content.length === 0) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // auto sync mask config from global config
      if (session.mask.syncGlobalConfig) {
        console.log("[Mask] syncing from global, name = ", session.mask.name);
        session.mask.modelConfig = { ...config.modelConfig };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };
  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateTargetSession(
      session,
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // delete the original messages
    deleteMessage(userMessage.id);
    deleteMessage(botMessage?.id);

    // resend the message
    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore.onUserInput(textContent, images).then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) =>
      session.mask.context.push(message),
    );

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  const accessStore = useAccessStore();
  const [speechStatus, setSpeechStatus] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  async function openaiSpeech(text: string) {
    if (speechStatus) {
      ttsPlayer.stop();
      setSpeechStatus(false);
    } else {
      var api: ClientApi;
      api = new ClientApi(ModelProvider.GPT);
      const config = useAppConfig.getState();
      setSpeechLoading(true);
      ttsPlayer.init();
      let audioBuffer: ArrayBuffer;
      const { markdownToTxt } = require("markdown-to-txt");
      const textContent = markdownToTxt(text);
      if (config.ttsConfig.engine !== DEFAULT_TTS_ENGINE) {
        const edgeVoiceName = accessStore.edgeVoiceName();
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          edgeVoiceName,
          OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
        );
        audioBuffer = await tts.toArrayBuffer(textContent);
      } else {
        audioBuffer = await api.llm.speech({
          model: config.ttsConfig.model,
          input: textContent,
          voice: config.ttsConfig.voice,
          speed: config.ttsConfig.speed,
        });
      }
      setSpeechStatus(true);
      ttsPlayer
        .play(audioBuffer, () => {
          setSpeechStatus(false);
        })
        .catch((e) => {
          console.error("[OpenAI Speech]", e);
          showToast(prettyObject(e));
          setSpeechStatus(false);
        })
        .finally(() => setSpeechLoading(false));
    }
  }

  const context: RenderMessage[] = useMemo(() => {
    return session.mask.hideContext ? [] : session.mask.context.slice();
  }, [session.mask.context, session.mask.hideContext]);

  if (
    context.length === 0 &&
    session.messages.at(0)?.content !== BOT_HELLO.content
  ) {
    const copiedHello = Object.assign({}, BOT_HELLO);
    if (!accessStore.isAuthorized()) {
      copiedHello.content = Locale.Error.Unauthorized;
    }
    context.push(copiedHello);
  }

  // preview messages
  const renderMessages = useMemo(() => {
    return context
      .concat(session.messages as RenderMessage[])
      .concat(
        isLoading
          ? [
              {
                ...createMessage({
                  role: "assistant",
                  content: "……",
                }),
                preview: true,
              },
            ]
          : [],
      )
      .concat(
        userInput.length > 0 && config.sendPreviewBubble
          ? [
              {
                ...createMessage({
                  role: "user",
                  content: userInput,
                }),
                preview: true,
              },
            ]
          : [],
      );
  }, [
    config.sendPreviewBubble,
    context,
    isLoading,
    session.messages,
    userInput,
  ]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );
  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };
  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  // clear context index = context length + index in messages
  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (text) => {
      if (accessStore.disableFastLink) return;
      console.log("[Command] got code from url: ", text);
      showConfirm(Locale.URLCommand.Code + `code = ${text}`).then((res) => {
        if (res) {
          accessStore.update((access) => (access.accessCode = text));
        }
      });
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
        };

        console.log("[Command] got settings from url: ", payload);

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update((access) => (access.openaiUrl = payload.url!));
            }
            accessStore.update((access) => (access.useCustomConfig = true));
          });
        }
      } catch {
        console.error("[Command] failed to get settings from url: ", text);
      }
    },
  });

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  // remember unfinished input
  useEffect(() => {
    // try to load from local storage
    const key = UNFINISHED_INPUT(session.id);
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = chatStore.currentSession().mask.modelConfig.model;
      if (!isVisionModel(currentModel)) {
        return;
      }
      const items = (event.clipboardData || window.clipboardData).items;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const images: string[] = [];
            images.push(...attachImages);
            images.push(
              ...(await new Promise<string[]>((res, rej) => {
                setUploading(true);
                const imagesData: string[] = [];
                uploadImageRemote(file)
                  .then((dataUrl) => {
                    imagesData.push(dataUrl);
                    setUploading(false);
                    res(imagesData);
                  })
                  .catch((e) => {
                    setUploading(false);
                    rej(e);
                  });
              })),
            );
            const imagesLength = images.length;

            if (imagesLength > 3) {
              images.splice(3, imagesLength - 3);
            }
            setAttachImages(images);
          }
        }
      }
    },
    [attachImages, chatStore],
  );

  async function uploadImage() {
    const images: string[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<string[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            uploadImageRemote(file)
              .then((dataUrl) => {
                imagesData.push(dataUrl);
                if (
                  imagesData.length === 3 ||
                  imagesData.length === files.length
                ) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    const imagesLength = images.length;
    if (imagesLength > 3) {
      images.splice(3, imagesLength - 3);
    }
    setAttachImages(images);
  }

  // 快捷键 shortcut keys
  const [showShortcutKeyModal, setShowShortcutKeyModal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      // 打开新聊天 command + shift + o
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setTimeout(() => {
          chatStore.newSession();
          navigate(Path.Chat);
        }, 10);
      }
      // 聚焦聊天输入 shift + esc
      else if (event.shiftKey && event.key.toLowerCase() === "escape") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      // 复制最后一个代码块 command + shift + ;
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Semicolon"
      ) {
        event.preventDefault();
        const copyCodeButton =
          document.querySelectorAll<HTMLElement>(".copy-code-button");
        if (copyCodeButton.length > 0) {
          copyCodeButton[copyCodeButton.length - 1].click();
        }
      }
      // 复制最后一个回复 command + shift + c
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        const lastNonUserMessage = messages
          .filter((message) => message.role !== "user")
          .pop();
        if (lastNonUserMessage) {
          const lastMessageContent = getMessageTextContent(lastNonUserMessage);
          copyToClipboard(lastMessageContent);
        }
      }
      // 展示快捷键 command + /
      else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowShortcutKeyModal(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [messages, chatStore, navigate]);

  const [showChatSidePanel, setShowChatSidePanel] = useState(false);

  return (
    <>
      <div className={styles.chat} key={session.id}>
        <div className="window-header" data-tauri-drag-region>
          {isMobileScreen && (
            <div className="window-actions">
              <div className={"window-action-button"}>
                <IconButton
                  icon={<ReturnIcon />}
                  bordered
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => navigate(Path.Home)}
                />
              </div>
            </div>
          )}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
              onClickCapture={() => setIsEditingMessage(true)}
            >
              {!session.topic ? DEFAULT_TOPIC : session.topic}
            </div>
            <div className="window-header-sub-title">
              {Locale.Chat.SubTitle(session.messages.length)}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<ReloadIcon />}
                bordered
                title={Locale.Chat.Actions.RefreshTitle}
                onClick={() => {
                  showToast(Locale.Chat.Actions.RefreshToast);
                  chatStore.summarizeSession(true, session);
                }}
              />
            </div>
            {!isMobileScreen && (
              <div className="window-action-button">
                <IconButton
                  icon={<RenameIcon />}
                  bordered
                  title={Locale.Chat.EditMessage.Title}
                  aria={Locale.Chat.EditMessage.Title}
                  onClick={() => setIsEditingMessage(true)}
                />
              </div>
            )}
            <div className="window-action-button">
              <IconButton
                icon={<ExportIcon />}
                bordered
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  setShowExport(true);
                }}
              />
            </div>
            {showMaxIcon && (
              <div className="window-action-button">
                <IconButton
                  icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                  bordered
                  title={Locale.Chat.Actions.FullScreen}
                  aria={Locale.Chat.Actions.FullScreen}
                  onClick={() => {
                    config.update(
                      (config) => (config.tightBorder = !config.tightBorder),
                    );
                  }}
                />
              </div>
            )}
          </div>

          <PromptToast
            showToast={!hitBottom}
            showModal={showPromptModal}
            setShowModal={setShowPromptModal}
          />
        </div>
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <div
              className={styles["chat-body"]}
              ref={scrollRef}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
                setAutoScroll(false);
              }}
            >
              {messages.map((message, i) => {
                const isUser = message.role === "user";
                const isContext = i < context.length;
                const showActions =
                  i > 0 &&
                  !(message.preview || message.content.length === 0) &&
                  !isContext;
                const showTyping = message.preview || message.streaming;

                const shouldShowClearContextDivider =
                  i === clearContextIndex - 1;

                return (
                  <Fragment key={message.id}>
                    <div
                      className={
                        isUser
                          ? styles["chat-message-user"]
                          : styles["chat-message"]
                      }
                    >
                      <div className={styles["chat-message-container"]}>
                        <div className={styles["chat-message-header"]}>
                          <div className={styles["chat-message-avatar"]}>
                            <div className={styles["chat-message-edit"]}>
                              <IconButton
                                icon={<EditIcon />}
                                aria={Locale.Chat.Actions.Edit}
                                onClick={async () => {
                                  const newMessage = await showPrompt(
                                    Locale.Chat.Actions.Edit,
                                    getMessageTextContent(message),
                                    10,
                                  );
                                  let newContent: string | MultimodalContent[] =
                                    newMessage;
                                  const images = getMessageImages(message);
                                  if (images.length > 0) {
                                    newContent = [
                                      { type: "text", text: newMessage },
                                    ];
                                    for (let i = 0; i < images.length; i++) {
                                      newContent.push({
                                        type: "image_url",
                                        image_url: {
                                          url: images[i],
                                        },
                                      });
                                    }
                                  }
                                  chatStore.updateTargetSession(
                                    session,
                                    (session) => {
                                      const m = session.mask.context
                                        .concat(session.messages)
                                        .find((m) => m.id === message.id);
                                      if (m) {
                                        m.content = newContent;
                                      }
                                    },
                                  );
                                }}
                              ></IconButton>
                            </div>
                            {isUser ? (
                              <Avatar avatar={config.avatar} />
                            ) : (
                              <>
                                {["system"].includes(message.role) ? (
                                  <Avatar avatar="2699-fe0f" />
                                ) : (
                                  <MaskAvatar
                                    avatar={session.mask.avatar}
                                    model={
                                      message.model ||
                                      session.mask.modelConfig.model
                                    }
                                  />
                                )}
                              </>
                            )}
                          </div>
                          {!isUser && (
                            <div className={styles["chat-model-name"]}>
                              {message.model}
                            </div>
                          )}

                          {showActions && (
                            <div className={styles["chat-message-actions"]}>
                              <div className={styles["chat-input-actions"]}>
                                {message.streaming ? (
                                  <ChatAction
                                    text={Locale.Chat.Actions.Stop}
                                    icon={<StopIcon />}
                                    onClick={() => onUserStop(message.id ?? i)}
                                  />
                                ) : (
                                  <>
                                    <ChatAction
                                      text={Locale.Chat.Actions.Retry}
                                      icon={<ResetIcon />}
                                      onClick={() => onResend(message)}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Delete}
                                      icon={<DeleteIcon />}
                                      onClick={() => onDelete(message.id ?? i)}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Pin}
                                      icon={<PinIcon />}
                                      onClick={() => onPinMessage(message)}
                                    />
                                    <ChatAction
                                      text={Locale.Chat.Actions.Copy}
                                      icon={<CopyIcon />}
                                      onClick={() =>
                                        copyToClipboard(
                                          getMessageTextContent(message),
                                        )
                                      }
                                    />
                                    {config.ttsConfig.enable && (
                                      <ChatAction
                                        text={
                                          speechStatus
                                            ? Locale.Chat.Actions.StopSpeech
                                            : Locale.Chat.Actions.Speech
                                        }
                                        icon={
                                          speechStatus ? (
                                            <SpeakStopIcon />
                                          ) : (
                                            <SpeakIcon />
                                          )
                                        }
                                        onClick={() =>
                                          openaiSpeech(
                                            getMessageTextContent(message),
                                          )
                                        }
                                      />
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {message?.tools?.length == 0 && showTyping && (
                          <div className={styles["chat-message-status"]}>
                            {Locale.Chat.Typing}
                          </div>
                        )}
                        {/*@ts-ignore*/}
                        {message?.tools?.length > 0 && (
                          <div className={styles["chat-message-tools"]}>
                            {message?.tools?.map((tool) => (
                              <div
                                key={tool.id}
                                title={tool?.errorMsg}
                                className={styles["chat-message-tool"]}
                              >
                                {tool.isError === false ? (
                                  <ConfirmIcon />
                                ) : tool.isError === true ? (
                                  <CloseIcon />
                                ) : (
                                  <LoadingButtonIcon />
                                )}
                                <span>{tool?.function?.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={styles["chat-message-item"]}>
                          <Markdown
                            key={message.streaming ? "loading" : "done"}
                            content={getMessageTextContent(message)}
                            loading={
                              (message.preview || message.streaming) &&
                              message.content.length === 0 &&
                              !isUser
                            }
                            //   onContextMenu={(e) => onRightClick(e, message)} // hard to use
                            onDoubleClickCapture={() => {
                              if (!isMobileScreen) return;
                              setUserInput(getMessageTextContent(message));
                            }}
                            fontSize={fontSize}
                            fontFamily={fontFamily}
                            parentRef={scrollRef}
                            defaultShow={i >= messages.length - 6}
                          />
                          {getMessageImages(message).length == 1 && (
                            <img
                              className={styles["chat-message-item-image"]}
                              src={getMessageImages(message)[0]}
                              alt=""
                            />
                          )}
                          {getMessageImages(message).length > 1 && (
                            <div
                              className={styles["chat-message-item-images"]}
                              style={
                                {
                                  "--image-count":
                                    getMessageImages(message).length,
                                } as React.CSSProperties
                              }
                            >
                              {getMessageImages(message).map((image, index) => {
                                return (
                                  <img
                                    className={
                                      styles["chat-message-item-image-multi"]
                                    }
                                    key={index}
                                    src={image}
                                    alt=""
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {message?.audio_url && (
                          <div className={styles["chat-message-audio"]}>
                            <audio src={message.audio_url} controls />
                          </div>
                        )}

                        <div className={styles["chat-message-action-date"]}>
                          {isContext
                            ? Locale.Chat.IsContext
                            : message.date.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {shouldShowClearContextDivider && <ClearContextDivider />}
                  </Fragment>
                );
              })}
            </div>
            <div className={styles["chat-input-panel"]}>
              <PromptHints
                prompts={promptHints}
                onPromptSelect={onPromptSelect}
              />

              <ChatActions
                uploadImage={uploadImage}
                setAttachImages={setAttachImages}
                setUploading={setUploading}
                showPromptModal={() => setShowPromptModal(true)}
                scrollToBottom={scrollToBottom}
                hitBottom={hitBottom}
                uploading={uploading}
                showPromptHints={() => {
                  // Click again to close
                  if (promptHints.length > 0) {
                    setPromptHints([]);
                    return;
                  }

                  inputRef.current?.focus();
                  setUserInput("/");
                  onSearch("");
                }}
                setShowShortcutKeyModal={setShowShortcutKeyModal}
                setUserInput={setUserInput}
                setShowChatSidePanel={setShowChatSidePanel}
              />
              <label
                className={clsx(styles["chat-input-panel-inner"], {
                  [styles["chat-input-panel-inner-attach"]]:
                    attachImages.length !== 0,
                })}
                htmlFor="chat-input"
              >
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  placeholder={Locale.Chat.Input(submitKey)}
                  onInput={(e) => onInput(e.currentTarget.value)}
                  value={userInput}
                  onKeyDown={onInputKeyDown}
                  onFocus={scrollToBottom}
                  onClick={scrollToBottom}
                  onPaste={handlePaste}
                  rows={inputRows}
                  autoFocus={autoFocus}
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily,
                  }}
                />
                {attachImages.length != 0 && (
                  <div className={styles["attach-images"]}>
                    {attachImages.map((image, index) => {
                      return (
                        <div
                          key={index}
                          className={styles["attach-image"]}
                          style={{ backgroundImage: `url("${image}")` }}
                        >
                          <div className={styles["attach-image-mask"]}>
                            <DeleteImageButton
                              deleteImage={() => {
                                setAttachImages(
                                  attachImages.filter((_, i) => i !== index),
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <IconButton
                  icon={<SendWhiteIcon />}
                  text={Locale.Chat.Send}
                  className={styles["chat-input-send"]}
                  type="primary"
                  onClick={() => doSubmit(userInput)}
                />
              </label>
            </div>
          </div>
          <div
            className={clsx(styles["chat-side-panel"], {
              [styles["mobile"]]: isMobileScreen,
              [styles["chat-side-panel-show"]]: showChatSidePanel,
            })}
          >
            {showChatSidePanel && (
              <RealtimeChat
                onClose={() => {
                  setShowChatSidePanel(false);
                }}
                onStartVoice={async () => {
                  console.log("start voice");
                }}
              />
            )}
          </div>
        </div>
      </div>
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showShortcutKeyModal && (
        <ShortcutKeyModal onClose={() => setShowShortcutKeyModal(false)} />
      )}
    </>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  return <_Chat key={session.id}></_Chat>;
}
