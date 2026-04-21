export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	// Allows to automatically instantiate createClient with right options
	// instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
	__InternalSupabase: {
		PostgrestVersion: '14.5';
	};
	graphql_public: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			graphql: {
				Args: {
					extensions?: Json;
					operationName?: string;
					query?: string;
					variables?: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	public: {
		Tables: {
			alerts: {
				Row: {
					alert_type: string;
					id: string;
					item_id: string;
					last_triggered_at: string | null;
					resolved_at: string | null;
				};
				Insert: {
					alert_type: string;
					id?: string;
					item_id: string;
					last_triggered_at?: string | null;
					resolved_at?: string | null;
				};
				Update: {
					alert_type?: string;
					id?: string;
					item_id?: string;
					last_triggered_at?: string | null;
					resolved_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'alerts_item_id_fkey';
						columns: ['item_id'];
						isOneToOne: false;
						referencedRelation: 'shelf_items';
						referencedColumns: ['id'];
					},
				];
			};
			product_catalog: {
				Row: {
					barcode: string;
					brand: string | null;
					full_weight_g: number | null;
					image_url: string | null;
					nutrition_facts: Json | null;
					product_name: string;
					tare_weight_g: number | null;
					unit: string | null;
				};
				Insert: {
					barcode: string;
					brand?: string | null;
					full_weight_g?: number | null;
					image_url?: string | null;
					nutrition_facts?: Json | null;
					product_name: string;
					tare_weight_g?: number | null;
					unit?: string | null;
				};
				Update: {
					barcode?: string;
					brand?: string | null;
					full_weight_g?: number | null;
					image_url?: string | null;
					nutrition_facts?: Json | null;
					product_name?: string;
					tare_weight_g?: number | null;
					unit?: string | null;
				};
				Relationships: [];
			};
			profiles: {
				Row: {
					created_at: string | null;
					default_low_stock_percent: number | null;
					email: string | null;
					first_name: string | null;
					id: string;
					last_name: string | null;
					phone_number: string | null;
					updated_at: string | null;
				};
				Insert: {
					created_at?: string | null;
					default_low_stock_percent?: number | null;
					email?: string | null;
					first_name?: string | null;
					id: string;
					last_name?: string | null;
					phone_number?: string | null;
					updated_at?: string | null;
				};
				Update: {
					created_at?: string | null;
					default_low_stock_percent?: number | null;
					email?: string | null;
					first_name?: string | null;
					id?: string;
					last_name?: string | null;
					phone_number?: string | null;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			shelf_items: {
				Row: {
					barcode: string;
					created_at: string | null;
					current_weight_g: number;
					device_timestamp: string | null;
					expiry_date: string | null;
					id: string;
					low_stock_threshold_g: number;
					quantity: number | null;
					scale_index: number;
					server_timestamp: string | null;
					shelf_id: string;
					sync_status: string | null;
					updated_at: string | null;
				};
				Insert: {
					barcode: string;
					created_at?: string | null;
					current_weight_g?: number;
					device_timestamp?: string | null;
					expiry_date?: string | null;
					id?: string;
					low_stock_threshold_g?: number;
					quantity?: number | null;
					scale_index: number;
					server_timestamp?: string | null;
					shelf_id: string;
					sync_status?: string | null;
					updated_at?: string | null;
				};
				Update: {
					barcode?: string;
					created_at?: string | null;
					current_weight_g?: number;
					device_timestamp?: string | null;
					expiry_date?: string | null;
					id?: string;
					low_stock_threshold_g?: number;
					quantity?: number | null;
					scale_index?: number;
					server_timestamp?: string | null;
					shelf_id?: string;
					sync_status?: string | null;
					updated_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'shelf_items_barcode_fkey';
						columns: ['barcode'];
						isOneToOne: false;
						referencedRelation: 'product_catalog';
						referencedColumns: ['barcode'];
					},
					{
						foreignKeyName: 'shelf_items_shelf_id_fkey';
						columns: ['shelf_id'];
						isOneToOne: false;
						referencedRelation: 'shelves';
						referencedColumns: ['id'];
					},
				];
			};
			shelf_members: {
				Row: {
					id: string;
					joined_at: string | null;
					role: string | null;
					shelf_id: string | null;
					user_id: string | null;
				};
				Insert: {
					id?: string;
					joined_at?: string | null;
					role?: string | null;
					shelf_id?: string | null;
					user_id?: string | null;
				};
				Update: {
					id?: string;
					joined_at?: string | null;
					role?: string | null;
					shelf_id?: string | null;
					user_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'shelf_members_shelf_id_fkey';
						columns: ['shelf_id'];
						isOneToOne: false;
						referencedRelation: 'shelves';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'shelf_members_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
				];
			};
			shelves: {
				Row: {
					created_at: string | null;
					id: string;
					last_synced_at: string | null;
					metadata: Json | null;
					name: string;
				};
				Insert: {
					created_at?: string | null;
					id?: string;
					last_synced_at?: string | null;
					metadata?: Json | null;
					name: string;
				};
				Update: {
					created_at?: string | null;
					id?: string;
					last_synced_at?: string | null;
					metadata?: Json | null;
					name?: string;
				};
				Relationships: [];
			};
			weight_logs: {
				Row: {
					id: string;
					item_id: string;
					recorded_at: string | null;
					weight_g: number;
				};
				Insert: {
					id?: string;
					item_id: string;
					recorded_at?: string | null;
					weight_g: number;
				};
				Update: {
					id?: string;
					item_id?: string;
					recorded_at?: string | null;
					weight_g?: number;
				};
				Relationships: [
					{
						foreignKeyName: 'weight_logs_item_id_fkey';
						columns: ['item_id'];
						isOneToOne: false;
						referencedRelation: 'shelf_items';
						referencedColumns: ['id'];
					},
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
		? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
		? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {},
	},
	public: {
		Enums: {},
	},
} as const;
