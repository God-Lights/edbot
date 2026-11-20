using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 재생 버튼을 누르면 씬이 비어 있어도 GameClient와 개발용 로비 화면을 자동으로 만든다.
    /// 진짜 UI와 씬이 생기면 이 파일을 지우고 씬에 GameClient를 직접 둔다.
    /// </summary>
    internal static class DevBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Create()
        {
            if (GameClient.Instance != null) return;

            var go = new GameObject("Edbot");
            go.AddComponent<GameClient>();
            go.AddComponent<DevLobbyGui>();
        }
    }
}
