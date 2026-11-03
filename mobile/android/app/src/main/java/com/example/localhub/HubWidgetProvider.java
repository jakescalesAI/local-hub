package com.example.localhub;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * Three shortcuts and nothing else. A widget shows outside the lock, so this reads nothing and stores
 * nothing, and each shortcut only opens the app, which goes through the lock before it acts.
 */
public class HubWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.hub_widget);
        views.setOnClickPendingIntent(R.id.widget_open, action(context, "open", 1));
        views.setOnClickPendingIntent(R.id.widget_compose, action(context, "compose", 2));
        views.setOnClickPendingIntent(R.id.widget_status, action(context, "status", 3));
        manager.updateAppWidget(ids, views);
    }

    private static PendingIntent action(Context context, String name, int request) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("localhub://action/" + name), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
