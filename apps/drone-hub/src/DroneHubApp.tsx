import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { DroneHubDndProvider } from './droneHub/app/drone-hub-dnd';
import { useDroneHubAppModel } from './use-drone-hub-app-model';

export default function DroneHubApp() {
  const { sidebarProps, overlaysProps, workspaceContentProps } = useDroneHubAppModel();
  return (
    <DroneHubDndProvider>
      <div className="flex h-screen overflow-hidden fixed inset-0">
        <DroneSidebar {...sidebarProps} />
        <DroneHubWorkspaceContent {...workspaceContentProps} />
        <DroneHubOverlays {...overlaysProps} />
        <GuidedOnboarding />
      </div>
    </DroneHubDndProvider>
  );
}
